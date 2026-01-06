#!/usr/bin/env bash
#
# tools/merge-no-results.sh
#
# A small wrapper that takes three arguments:
#   $1 = path/to/base_noResultQueries
#   $2 = path/to/ours_noResultQueries
#   $3 = path/to/theirs_noResultQueries
#
# It then merges the contents of “theirs” into “ours” (via union, no duplicates)
# using mergeAppendOnly.js.  The result is written back to “ours” ($2).
#
# Usage (Git will call this with):
#   tools/merge-no-results.sh <base> <ours> <theirs>
#

set -euo pipefail

BASE_FILE="$1"
OURS_FILE="$2"
THEIRS_FILE="$3"

# Ensure the directory for the “ours” file exists (e.g. .repoMetrics/)
mkdir -p "$(dirname "$OURS_FILE")"

# If “ours” doesn’t exist yet, start with an empty file
if [ ! -f "$OURS_FILE" ]; then
  echo -n "" > "$OURS_FILE"
fi

# If “theirs” doesn’t exist, nothing to merge—just keep “ours” as is
if [ ! -f "$THEIRS_FILE" ]; then
  exit 0
fi

# We want to produce a union of “ours” + “theirs” (no duplicate lines).
# mergeAppendOnly.js expects two args: (baseFile, targetFile).  We can
# simply pass “theirs” as the “baseFile” and “ours” as the “targetFile”,
# so that any lines in “theirs” not already in “ours” get appended.

# (If you truly needed a three-way diff with base, you could run more
# complex logic.  But for “append‐only” history, this union is usually enough.)

# Invoke the Node script:
node "$(dirname "$0")/tools/mergeAppendOnly.js" "$THEIRS_FILE" "$OURS_FILE"

# At this point, “ours” has been updated in place to include every unique line
# from both “ours” and “theirs.”  Exit successfully
exit 0
