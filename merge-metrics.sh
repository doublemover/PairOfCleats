#!/usr/bin/env bash
#
# merge-metrics.sh: a Git merge driver for .repoMetrics/metrics.json
#
# Git will invoke this with three positional arguments:
#   $1 = “base” (common ancestor)
#   $2 = “ours” (current branch copy, i.e. HEAD)
#   $3 = “theirs” (the branch you’re merging in)
#
# We want to produce a merged JSON object in-place at “ours” ($2).
#
# Merge logic: take each object’s keys, and for each file‐key, pick the
# version that has the highest “md” and “code” counts. You could adjust
# this to “latest timestamp wins,” “sum them,” or however you prefer.

BASE="$1"
OURS="$2"
THEIRS="$3"

# If any of them is missing/invalid JSON, fallback to one side:
if ! jq empty "${BASE}" >/dev/null 2>&1; then
  # no valid base → just take “ours” by default
  cat "${OURS}" >"${OURS}"
  exit 0
fi
if ! jq empty "${THEIRS}" >/dev/null 2>&1; then
  # “theirs” is broken JSON → keep ours
  cat "${OURS}" >"${OURS}"
  exit 0
fi

# Now do a three‐way merge via jq:
# We’ll load the three JSON objects (as dictionaries), and then:
#   merged = reduce each key from all three into one object,
#     picking “max(md)” and “max(code)” for each key.
#
# If you have a different policy (e.g. last‐modified wins, or sum them),
# just adjust the jq expression accordingly

jq -s '
  # . is an array [base, ours, theirs]
  def mergeTwo($a; $b):
    # For each key in ($a + $b), choose the “larger” counts (md & code).
    reduce ($a | keys_unsorted + ($b | keys_unsorted))[] as $k
      ({}; .[$k] =
         (
           ($a[$k] // {}) as $aval
           | ($b[$k] // {}) as $bval
           | {
               md: ([$aval.md // 0, $bval.md // 0] | max),
               code: ([$aval.code // 0, $bval.code // 0] | max),
               terms: ($aval.terms // []) + ($bval.terms // [])
             }
         )
      );
  # First merge “base” and “ours,” then merge the result with “theirs.”
  reduce .[] as $obj ({}; mergeTwo(.; $obj))
' "${BASE}" "${OURS}" "${THEIRS}" \
  > "${OURS}.merged"

# Overwrite “ours” with the merged result
mv "${OURS}.merged" "${OURS}"

exit 0
