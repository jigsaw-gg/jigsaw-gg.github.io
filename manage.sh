#!/usr/bin/env bash

CALLER_PATH=$(pwd)
SCRIPT_FULL_PATH=$(realpath $0)
ROOT_DIRECTORY_FULL_PATH=$(dirname $SCRIPT_FULL_PATH)

THIS_SCRIPT=$SCRIPT_FULL_PATH

# config.json is absent in a fresh worktree until setup-worktree copies it.
# Resolve the agent-tooling interpreter only for commands that launch it.
load_agent_tooling() {
    AGENT_TOOLING_DIR=$(jq -r '.agent_tooling_root_dir' config.json)
    pushd $AGENT_TOOLING_DIR > /dev/null
    AGENT_TOOLING_PYTHONEXE=$(uv run bash -c 'which python')
    popd > /dev/null
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

else
    echo "Unknown command: $1"
    exit 1
fi
