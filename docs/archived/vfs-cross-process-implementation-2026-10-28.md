# Original VFS document pins across processes — 2026-10-28

Source `ab9dbafb0b42c30c327d0ac94c66eeba74e04e14`, tree
`6f1f3ff34c3eaf72a530eb032b21fcf449c648c9`, branch
`codex/pr557-audit-repairs-20261012`. Unpublished; functional qualification pending.

#1643's remaining cross-process writer gap now uses existing file-lock,
reader/exclusion and original resource-session owners. One exact-document guard
serializes qualification, shared pin admission and atomic publication. Equal
verified source can share pins; replacement needs zero existing exact-file pins.
Unknown/dead resource records remain protected. Stale writer-lock retirement
requires the exact existing producer and a definitely dead local initiating PID.

The original provider lifetime owns durable document pins through idle reuse,
every accepted materializer and synchronous/asynchronous cold-cache publication.
Original callback/independent observer failure remains required even after a
later callback returns true. Failed pin metadata retirement retains its actual
recovery capability; retrying it does not repeat source writes or client shutdown.
Leaf pins retire before the consumer's canonical category admission. Successful
uncached operations retain their pin through the final original callback.

Coordination lives under the actual selected materialization root, independent
of application-home selection. `.poc-vfs-access` is reserved from virtual source,
including canonical aliases and Windows case/trailing-dot spellings. Exact-file
pins avoid a redundant category lease for every document; canonical category
admission stays with the actual provider session. Neither pins nor a configured
external path grant deletion authority or prevent uncooperative OS writes.
LSP binding version 58 invalidates earlier derived lifetime assumptions.

Ten independently selectable cases are authored in
`tooling/vfs/cross-process-publication/*` and **not executed**: conflicting writers,
equal-content sharing, different launch homes, independent documents, no requested
doc hash, unknown ownership, pending cache publication, original metadata failure,
independent observer retention and reserved namespaces. Child controls use the
real materializer, IPC barriers, bounded deadlines and hidden native launches;
the parent requires original consumer retirement and actual child exit. No LSP
executable, model, physical link or elevated launch is involved.

Static format/ESLint, four changed JavaScript syntax checks, whitespace and
shared-module cycle analysis (zero) completed. No functional/child fixture,
native campaign, benchmark or publication front gate ran. Dependency inputs
remain the successful locked-bootstrap inputs in the exact-budget receipt.

#1643 remains partial: custom/external producer registration and category cleanup,
existing root/content/provider/storage cases, original/follow-up acceptance and
actual adapter/runtime qualification remain. #1267/#1574 retain shared cleanup,
quota, category and broader backend adoption. No issue is closed by this source.

The 120-commit checkpoint re-enumerated all live open GitHub reports: 718 unique
issues, #131–#1748, with eight overlapping created-date pages. PR coverage retains
each once: 473 implementation-recorded/qualification-pending, 144 partial and 101
unresolved. Qualified closing references stay separate and unchanged. These
classifications include local source; published head remains `adbcaf777ce91642bb0a60de892171d8c3a529f7`.
