#!/usr/bin/env bash

CALLER_PATH=$(pwd)
SCRIPT_FULL_PATH=$(realpath $0)
ROOT_DIRECTORY_FULL_PATH=$(dirname $SCRIPT_FULL_PATH)

THIS_SCRIPT=$SCRIPT_FULL_PATH
SERVER_MANIFEST="${ROOT_DIRECTORY_FULL_PATH}/apps/server/Cargo.toml"

# config.json is absent in a fresh worktree until setup-worktree copies it.
# Resolve the agent-tooling interpreter only for commands that launch it.
load_agent_tooling() {
    AGENT_TOOLING_DIR=$(jq -r '.agent_tooling_root_dir' config.json)
    pushd $AGENT_TOOLING_DIR > /dev/null
    AGENT_TOOLING_PYTHONEXE=$(uv run bash -c 'which python')
    popd > /dev/null
}

# Docker-style KEY=VALUE loader (no shell evaluation; keeps ; & etc. literal).
load_dotenv() {
    local env_file=$1
    local line key value
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ -z "$line" || "$line" == \#* ]] && continue
        key=${line%%=*}
        value=${line#*=}
        export "$key=$value"
    done < "$env_file"
}


if [[ "$1" == "pre-commit" ]]; then
    shift

    git add -A
    # git reset manage.sh
    git reset -- dev/
    uvx pre-commit run -a | cat

    LAST_PIPE_STATUS=${PIPESTATUS[0]}
    exit $LAST_PIPE_STATUS

elif [[ "$1" == "run-mcp-stdio" ]]; then
    shift
    load_agent_tooling

    export PYTHONPATH=$AGENT_TOOLING_DIR:$PYTHONPATH

    ${AGENT_TOOLING_PYTHONEXE} -m dev_agent.mcp_stdio "$@" | cat
    LAST_PIPE_STATUS=${PIPESTATUS[0]}
    exit $LAST_PIPE_STATUS

elif [[ "$1" == "gen-proto" ]]; then
    shift
    bash "$ROOT_DIRECTORY_FULL_PATH/scripts/gen-proto.sh" "$@"
    exit $?

elif [[ "$1" == "run-rust-server-local" ]]; then
    shift
    cd "$ROOT_DIRECTORY_FULL_PATH" || exit 1

    ROOT_ENV="$ROOT_DIRECTORY_FULL_PATH/.env"
    SERVER_ENV="$ROOT_DIRECTORY_FULL_PATH/apps/server/.local.env"
    if [[ -f "$ROOT_ENV" ]]; then
        load_dotenv "$ROOT_ENV"
    fi
    if [[ -f "$SERVER_ENV" ]]; then
        load_dotenv "$SERVER_ENV"
    fi

    CERT_DIR="$ROOT_DIRECTORY_FULL_PATH/apps/server/certs"
    CERT_FILE="$CERT_DIR/localhost+1.pem"
    KEY_FILE="$CERT_DIR/localhost+1-key.pem"
    if [[ ! -f "$CERT_FILE" || ! -f "$KEY_FILE" ]]; then
        echo "Missing WebTransport certs:" >&2
        echo "  $CERT_FILE" >&2
        echo "  $KEY_FILE" >&2
        echo "Generate with: mkcert -cert-file \"$CERT_FILE\" -key-file \"$KEY_FILE\" localhost 127.0.0.1" >&2
        exit 1
    fi
    export CERT_DIR CERT_FILE KEY_FILE

    exec cargo run --manifest-path "$SERVER_MANIFEST" "$@"

else
    echo "Unknown command: $1"
    exit 1
fi
