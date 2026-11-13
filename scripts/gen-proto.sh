#!/usr/bin/env bash
# Copy protos from jigsaw-gg-server and generate Connect-ES / Protobuf-ES clients.
set -euo pipefail

ROOT_DIRECTORY_FULL_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIRECTORY_FULL_PATH"

CONFIG_PATH="${ROOT_DIRECTORY_FULL_PATH}/config.json"
if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "error: config.json not found at ${CONFIG_PATH}" >&2
  echo "Set jigsaw_gg_server_repo_dir there (see main checkout)." >&2
  exit 1
fi

SERVER_DIR="$(jq -r '.jigsaw_gg_server_repo_dir // empty' "$CONFIG_PATH")"
if [[ -z "$SERVER_DIR" || "$SERVER_DIR" == "null" ]]; then
  echo "error: config.json is missing jigsaw_gg_server_repo_dir" >&2
  exit 1
fi
if [[ ! -d "$SERVER_DIR/proto" ]]; then
  echo "error: proto dir not found: ${SERVER_DIR}/proto" >&2
  exit 1
fi

PROTO_COUNT="$(find "$SERVER_DIR/proto" -type f -name '*.proto' | wc -l | tr -d ' ')"
if [[ "$PROTO_COUNT" -eq 0 ]]; then
  echo "error: no .proto files under ${SERVER_DIR}/proto" >&2
  exit 1
fi

echo "Copying ${PROTO_COUNT} proto file(s) from ${SERVER_DIR}/proto → proto/"
rm -rf proto
mkdir -p proto
# Preserve relative paths under proto/ (currently flat; nested stays nested).
rsync -a --include='*/' --include='*.proto' --exclude='*' "${SERVER_DIR}/proto/" proto/

echo "Generating Connect-ES / Protobuf-ES into src/gen/"
rm -rf src/gen
mkdir -p src/gen
npx buf generate

echo "Formatting generated TypeScript"
npx prettier --write --config .prettierrc "src/gen/**/*.{ts,tsx}"

echo "Done."
