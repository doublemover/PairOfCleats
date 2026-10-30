# Managed selection inspection ownership — 2026-10-27

**UNVALIDATED implementation:** source `6154945a4d1d6bb4cb4db6de673c0220134690c2`,
tree `cf49e9714c31f70468130c4f0102980c9562e07d`, branch
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
Local checkpoint only; no publication/front-gate or functional acceptance.

## Changes

Go, Lua and generic managed-tool discovery now retain unresolved original
inspection failures before reporting missing/invalid selections. Lua diagnostic
projection checks settlement before inspecting error fields. Ordinary absent,
malformed and changed selections retain their existing negative behavior.

Full managed-generation inspection uses the shared contained-file owner for
payload reads and a synchronous counterpart of the existing storage-directory
owner for bounded enumeration. It captures the original Dir object and methods,
retains pending reads/closes and exposes close-only recovery. File witnesses are
added only after the original file closes; the full inventory remains private
until containing directories also close. Size/entry/authority/single-link and
byte-identity checks remain, with explicit positive short-read progress bounds.

Retained consumer admission now protects the exact tool and tooling category
before its first full inspection. The existing repeated descriptor/install
identity check runs under that same lifetime. Each invocation has a distinct
resource identity. A pending inspection retains those leases and exposes
`managedInspectionSession.releaseAfterClosure()`: original file, original Dir,
then exact storage metadata. Recovery cannot rescan, execute a consumer or turn
an interrupted inspection into a byte witness. Forced error aggregation preserves
original observations when a later metadata release also fails.

The LSP qualification owner no longer flattens unresolved PHP launcher/artifact
hash reads into ordinary negative reports. First-search source identity includes
the Lua locator and synchronous directory owner. No public knob, format version,
retry/deadline threshold or installation/deletion authority was relaxed.

## Authored coverage

`tooling/install/managed-selection-lifetime/*` contains 16 independently bounded,
**unexecuted** cases: Go/Lua/generic selection reads, full inspection selection/
file/Dir failures, initial and repeated retained inspections, retained payload/
Dir failure, metadata release after physical closure, original Dir-close capture
and successful retained reuse. Fixtures use inert canonical receipts and ordinary
files; no executable, installer, network, symlink or other platform is involved.

Existing `managed-retain-partial-admission`, managed publication/digest checks,
shared storage-directory checks and command/discovery callers remain relevant
for the deferred execution batch. They have not been rerun against this source.

Static format/ESLint, changed JavaScript syntax, config budget and whitespace
checks passed; shared-module cycle analysis found zero cycles. Generated
configuration inventory and command inventory were refreshed through their
owners. No project functional fixture was executed.

#1574 remains open for remaining backend/custom cleanup adoption and runtime
qualification. These source changes do not establish live consumer/protocol,
whole-suite, actual install or cross-platform acceptance for #631 or #1559.
