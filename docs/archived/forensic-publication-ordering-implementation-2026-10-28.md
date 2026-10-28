# Forensic publication ordering and accepted drain — 2026-10-28

Source `3639069ca9bed027dc8065cb369a9b38351df69a`, tree
`12ba2a1c54211fce5a270d62996373d8c57731be`, branch
`codex/pr557-audit-repairs-20261012`. Local, unpublished and functionally unqualified.

The actual crash logger now uses one extracted forensic publisher. Existing
payload/index atomic writers and the shared PQueue serialize publication within
one logger; the queue loads only on use. Accepted JSON snapshots precede async
work, so mutation of caller bundles cannot change an accepted record. Only a fully
settled payload/index/append outcome supplies an in-memory dedup path. Kind joins
signature in the key, correcting cross-kind aliasing. Matching in-flight calls
join the raw outcome and retain individual required/optional policy; an optional
first caller cannot turn a required follower's failed publication into null success.

Required failures remain visible to flush until explicit successful publication
for that key. This retries diagnostic publication only, never application/native
work. Accepted caller barriers include warning/observer work. Close stops intake,
drains forensic work before append barriers, and independently settles all four
append closes even when an earlier owner fails. Frozen originals, original
observers, independent warning resources and late revocation survive projection.
One owner's flush failure no longer skips other native file handles' closes.

Serialized retention/work admission is bounded: 2 MiB payload, 8 MiB pending,
32 MiB total accepted payloads, 32 simultaneous callers and 512 write attempts
per logger. Failed attempts consume their declared payload allowance. These
limits do not claim bounded stringify peak, a physical directory quota or removal
of old evidence. No public CLI/config surface changed. Existing committed bundle
and index JSON semantics remain; the old private signature helper's only consumer
was the replaced forensic implementation, while other SHA1/retention uses remain.

Eighteen `indexing/forensic-publication-ordering/*` controls are authored:
same-key pending dedup, different-key serialization, cross-kind identity,
snapshot mutation, optional/required arrival order, failed index/cache repair,
flush/close barriers and late intake, all independent append closes after failure,
pending/replaced/revoked original observations, exact/pending warning failure,
pending work and payload admission. They use real small atomic files with
deterministic fixture gates; no child or native binding launches. **All 18 and
the original retention/SQLite diagnostics fixtures are unexecuted.**

Format/ESLint, three changed JavaScript syntax checks, static inventory and
whitespace checks passed; shared-module analysis found zero cycles. No functional
test, debugger, native/child/model/install/benchmark campaign ran. Dependencies
and verified setup inputs are unchanged.

#248 remains partial. Actual wrapper/CDB/dump/lifecycle/symbol qualification,
immutable generation replay and original crash attribution remain. Serialization
within one logger is not cross-instance authority or a crash-atomic transaction
between bundle and index; failed writes retain evidence. The live source inventory
remains 482 qualification pending / 146 partial / 90 unresolved of 718 open issues.
