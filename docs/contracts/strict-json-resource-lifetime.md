# Strict shared JSON reader lifetime

Status: source and authored regressions are **UNVALIDATED**. No executable,
format/bootstrap or native/platform checks have run.

`readJsonFile` and `readJsonFileResolved` now use the same internal regular-file
descriptor borrower as the safe JSON readers. They retain original FileHandle
read/stat/close ownership, bounded positioned short-read completion and stable
opened-file checks. Text decoding and parsing wait for confirmed standard void
close; strict failures propagate without a fallback conversion.

The direct reader still forwards its original reviver to `JSON.parse`, with
normal reviver receiver and returned falsey values. A failed descriptor close
cannot run a reviver or return parsed data. Its existing actual contained-file
capability can reconcile only the captured descriptor, without reading, parsing
or invoking the reviver again. A fresh explicit read is a new operation. Reviver
or malformed-JSON failures after successful close retain their ordinary error
identity and have no invented active descriptor capability.

`tests/shared/json-file-resource-lifetime.test.js` authors both actual strict
consumers with a failed native close, no parse/reviver replay during explicit
recovery, actual reviver-after-close receiver checks, falsey JSON values and
ordinary syntax failures. Existing `tests/shared/json-file.test.js` behavior
checks remain unchanged. Safe-reader bounds/fallback distinctions are described
in [JSON fallback lifetime](json-fallback-resource-lifetime.md).

The write functions in `json-file.js` remain separate raw write/publication
lifetimes. This reader change adds no path mutation, resource registry,
coordinator/category authority or cross-process settlement proof. Other raw
streams and native/performance acceptance remain open; no issue completion is
asserted.
