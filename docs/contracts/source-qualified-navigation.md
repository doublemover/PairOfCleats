# Source-qualified indexed navigation

`tooling navigate` retains its spelling-search path for compatibility, explicitly
labelled `status: approximate` and `binding.status: unqualified-spelling`. It does
not establish a unique binding. Completions and document-symbol selection retain
their existing behavior.

Definitions/references may instead provide `--source-hash` (SHA-256 of exact UTF-8
document bytes), `--source-version`, `--line`, `--column`, `--coordinate-unit utf16`
and `--include-declaration true|false`. Lines/columns are one-based; columns and
record spans count UTF-16 code units. The document version is echoed request
identity, not evidence that an editor buffer is still current. Editor publication
must separately fence its request/version. Dirty-buffer transport is not inferred.

The qualified path opens one published semantic generation and consumes retained
source, occurrence, binding and binding-candidate witnesses. Spelling never unions
candidate identities. Only uniquely resolved recorded bindings with exact static
candidate evidence produce a precise target. Candidate choices retain canonical
record refs; ambiguous, unresolved, external and partial states remain distinct.
References additionally check each occurrence's binding against the selected
target and honor includeDeclaration. There is no second compiler/LSP client.

Locations use retained source manifests/line starts. Retained bytes and current
contained source bytes must match their pinned hash before returning coordinates;
no offset is joined against unrelated live text. Generated/mapped sources require
their explicit mapping adapter and are currently partial. External targets are
reported without launching their URI. Required-artifact corruption propagates as
an error rather than becoming a successful empty navigation result.

Work uses the existing semantic reader scope and abort ownership, a 250-ms budget,
32,768 examined-row bound and 4-MiB encoded read-work allowance. Precise result
admission is at most 200 rows; candidate previews at most 25 and contexts at most
16. These are operation/retention controls, not RSS or latency qualifications.
Budget/cap/incomplete binding coverage is explicit partial evidence. The present
source lookup can scan source manifests and does not expose navigation continuation;
large-generation lookup indexing/resume remains an open implementation improvement.

This is an **unvalidated source checkpoint**, not closure of #1303. The authored
ordinary-file/store-interface control covers shadowed names, imported aliases,
declaration policy, Unicode/CRLF ranges, hash drift, authority, incomplete work and
corruption. Actual producer -> persisted facts -> both editor hosts, generated
source mappings, large-generation indexing and full runtime qualification remain
required. No test, native setup or editor-host run is implied by this document.
