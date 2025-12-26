#!/usr/bin/env bash
set -euo pipefail

BASE_FILE="$1"
OURS_FILE="$2"
THEIRS_FILE="$3"

mkdir -p "$(dirname "$OURS_FILE")"

if [ ! -f "$OURS_FILE" ]; then
  : > "$OURS_FILE"
fi

if [ ! -f "$THEIRS_FILE" ]; then
  exit 0
fi

node "$(dirname "$0")/mergeNoResultQueries.js" "$THEIRS_FILE" "$OURS_FILE"

exit 0
