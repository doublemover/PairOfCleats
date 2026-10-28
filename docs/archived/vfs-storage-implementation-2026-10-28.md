# Canonical VFS storage admission — 2026-10-28

**Unvalidated source:** `4bdecbafad29592278b34d5715a2c992a49634e3`, tree
`629b276a8d733183881317dc440edb162beedc5e`; Windows x64, Node 26.12.1,
branch `codex/pr557-audit-repairs-20261012`. Not pushed or functionally qualified.

The [consumer lifetime repair](vfs-consumer-implementation-2026-10-28.md) now
composes with existing canonical storage admission. The actual runtime supplies
repository, effective configuration and captured parent launch environment through
semantic and legacy tooling passes and generic/dedicated/Clangd/Pyright/SourceKit
adapters. File-backed collection admits the selected materialization root before
its first publication; physical-URI-only and token-URI work acquire no unused root.

The existing native-reader storage owner validates canonical selection and locator
identity, protecting the exact build root, repository and selected category
ancestors. Consumer reuse retains one owner per root/launch namespace using the
existing bounded registration. Different generations and launch homes stay distinct.
External roots or context-free callers acquire no inferred category authority.

Client closure and all started file/cache observations precede metadata release.
Every admitted metadata owner is attempted; failed cleanup retains both its actual
recovery handle and in-process publication references. Unknown partial admission
retains the original owner, and failed admission prohibits later materialization
through that consumer. Retirement never deletes files or repeats failed work.

Seven **unexecuted** `tooling/vfs/consumer-storage-admission/*` cases cover actual
canonical leases with inert client/native controls: live/idle lifetime, exclusion
admission race, failed metadata removal, external-root protection, distinct launch
homes, multiple generations and independently pending file/cache work. Existing
pool/provider/VFS/storage integration checks remain required on the final candidate.

Format/ESLint, changed JavaScript syntax, config budget, command inventory and
whitespace checks pass; shared-module analysis reports zero cycles. No functional
fixture, native server, child, benchmark or publication front gate ran.

Remaining source work includes orderly same-origin content-revision turnover in
the existing pool, cross-process writer arbitration and external/custom producer
registration. Full original/follow-up #1643 acceptance and broader #1267/#1574
category/backend adoption remain. No native crash attribution or runtime pass is
claimed.
