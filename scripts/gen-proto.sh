#!/usr/bin/env bash
# Generate TS clients from repo-root proto/ and Protobuf-ES / Connect-ES output.
set -euo pipefail

ROOT_DIRECTORY_FULL_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIRECTORY_FULL_PATH"

PROTO_DIR="${ROOT_DIRECTORY_FULL_PATH}/proto"
if [[ ! -d "$PROTO_DIR" ]]; then
  echo "error: proto dir not found: ${PROTO_DIR}" >&2
  exit 1
fi

PROTO_COUNT="$(find "$PROTO_DIR" -type f -name '*.proto' | wc -l | tr -d ' ')"
if [[ "$PROTO_COUNT" -eq 0 ]]; then
  echo "error: no .proto files under ${PROTO_DIR}" >&2
  exit 1
fi

GEN_DIR="${ROOT_DIRECTORY_FULL_PATH}/apps/web/src/network/gen"
echo "Generating Connect-ES / Protobuf-ES into apps/web/src/network/gen/"
rm -rf "$GEN_DIR"
mkdir -p "$GEN_DIR"
npx buf generate

echo "Formatting generated TypeScript"
npx prettier --write --config .prettierrc "apps/web/src/network/gen/**/*.{ts,tsx}"

echo "Done."
