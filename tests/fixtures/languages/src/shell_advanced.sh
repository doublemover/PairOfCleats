#!/usr/bin/env bash

# Loads common helpers.
source "./scripts/common.sh"

log_info() {
  echo "[info] $1"
}

build_index() {
  local path="$1"
  log_info "Indexing $path"
  grep -R "TODO" "$path" | wc -l
}

main() {
  build_index "./src"
}

main "$@"
