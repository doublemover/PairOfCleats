# SQLite crash capability and primary diagnostics — 2026-10-28

Source `03c44b27843fb6096695e3e80849ebc8383449ca`, tree
`90747b1a071b5d2fc001194de469c01dd7e6a3c1`, branch
`codex/pr557-audit-repairs-20261012`. Local, unpublished and functionally unqualified.

#248's remaining source defect is real: the isolate chose/created/scanned a dump
directory, passed no dump-producing mechanism to its ordinary Node child, then
reported capture enabled merely because the directory existed. The boundary now
reports requested capture unavailable (or explicitly unsupported) until a scoped
native collector is configured. It creates no placeholder directories and claims
no unrelated files. The private recursive scanner, path-token sanitizer and
directory resolver were removed: their only call sites were this unowned scan/
placeholder path, none was exported, and the child invocation consumed no dump
path or collector. Their behavior could not establish an owned dump.

The same source review found null process status coerced to zero, empty stdout
accepted as JSON success, and replay/logging errors able to replace the native
failure. Numeric zero/no signal and complete nonempty object JSON are now required;
null/string status, truncated capture and malformed/nonobject JSON fail. Original
child observations survive projection/logging. Replay v1.1 keeps unknown numeric
fields null and records unavailable output without invoking object coercion.
Native primary errors precede required replay publication and warnings; frozen
failure/pending resource causes remain secondary, with no child retry. The actual
Stage3 reporting catch also preserves original work through diagnostic failure.

The existing forensic owner accepts internal required publication for this path,
propagates actual IO/resource failure and rolls back only its matching failed
dedup candidate. Already-written evidence remains. Optional confirmed ordinary
IO diagnostics retain their original behavior. Full concurrent/index/close
serialization and crash-atomic forensic publication are not claimed.

The real isolate fixture's dependency skip was obsolete: bootstrap readiness
explicitly requires verified better-sqlite3, and the fixture requires that native
functionality. It now imports the required binding directly. Every original
positive vector, native-style exit, replay and forensic index assertion remains;
new assertions distinguish simulated status from actual dump capture.

Twenty-seven `indexing/embeddings/sqlite-dense-boundary-diagnostics/*` controls
cover pure capability states without dump I/O, signed/unsigned simulated native
failure, strict status/JSON/capture evidence, original pending/replaced/independent
child observations, late revocation, exact launch/publication/warning failures,
pending publication/diagnostics, untrusted fixture refusal, required/optional real
forensic write/index failure and explicit repair, unknown metadata and untrusted
output coercion. Fixtures explicitly select the test runner; no process is
launched. **All 27 controls and the affected real isolate fixture are unexecuted.**

Format/ESLint, five JavaScript syntax checks, static inventory and whitespace
checks passed; shared-module analysis found zero cycles. Dependencies are unchanged.
No project functional fixture, native operation, child, collector, installation
or publication gate ran. Microsoft primary debugger documentation was reviewed
for the remaining scoped collector; no external execution occurred.

#248 moves to partial. Real optional Windows collection, owned dump validation/
exception context/stacks/modules and targeted native/replay qualification remain,
along with forensic ordering/lifecycle work. #1267 remains partial. This repair
does not prove the cause or closure of a native crash. Current source inventory:
**482 qualification pending / 146 partial / 90 unresolved**, 718 live open issues.
