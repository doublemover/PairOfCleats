#!/usr/bin/env bash
set -euo pipefail

BASE="$1"
OURS="$2"
THEIRS="$3"

if ! jq empty "${BASE}" >/dev/null 2>&1; then
  cat "${OURS}" >"${OURS}"
  exit 0
fi
if ! jq empty "${THEIRS}" >/dev/null 2>&1; then
  cat "${OURS}" >"${OURS}"
  exit 0
fi

jq -s '
  def mergeTwo($a; $b):
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
  reduce .[] as $obj ({}; mergeTwo(.; $obj))
' "${BASE}" "${OURS}" "${THEIRS}" > "${OURS}.merged"

mv "${OURS}.merged" "${OURS}"

exit 0
