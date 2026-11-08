# Clangd acquisition ownership — 2026-10-27

**UNVALIDATED implementation:** source `773e6893e18e1e570562a41a280231109f6c61f8`,
tree `b0148abf29809f66b48e26ba83eb2cf9128dc048`, branch
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
This local source checkpoint has not been pushed or functionally qualified.

## Implemented deliverable

The canonical Clangd recipe now invokes an internal owned archive acquisition
directly instead of starting another Node installer. One storage session and one
inclusive reservation cover official release metadata, retained ZIP, extraction,
version verification and publication. No generic outer package-child reservation
charges the same operation twice. The bound derives from existing enforced caps:
128 MiB compressed, 768 MiB extracted, plus a 32 MiB metadata margin, all under the
selected tooling root. Storage accounting remains logical bytes, not filesystem
capacity isolation or measured native peak usage.

The cache layout, release source/digest/size/target checks, builtin headers,
no-overwrite pointer publication and compatible-cache reuse remain. The preview
reports the internal acquisition, latest-stable official release selector and
maximum download bytes. It leaves exact version unresolved until metadata is
read; this is not immutable preapproval of future release metadata. First-search
source identity now includes the Clangd implementation and shared file readers.

The version probe uses the existing asynchronous subprocess owner, with hidden
Windows windows, bounded output and a ten-second deadline. Its temporary routes
stay inside the protected transaction. Signal cancellation is passed to download
and probe owners and checked before publication. Probe settlement is explicit;
cancelled-but-closed and genuinely pending resources remain distinct.

Failed archive acquisition exposes `installArchiveSession.releaseAfterClosure()`
to join actual download/archive cleanup and then release allocation/category
owners. Recovery never repeats extraction, verification or activation. Original
frozen errors and secondary cleanup failures retain their error edges.

Managed binary headers, hashes and receipt text now capture original descriptor
operations and use the existing contained-file lifetime owner. Pending reads
prevent premature close; recovery borrows the original descriptor without
replaying payload work. Clangd discovery propagates pending ownership instead of
flattening it into a missing-tool result. This does not complete every legacy
tool locator or custom adapter adoption under #1574.

## Authored checks and remaining scope

Twenty independently selectable cases were authored, without execution:

- `tooling/install/clangd-owned-acquisition/*`: 13 cases covering canonical
  recipe/preview, a single active reservation through publication, compatible
  reuse, index/archive download teardown, pending/frozen probes, missing exact
  settlement, wrong version, cancellation, and shared probe result/error handling.
- `tooling/install/managed-tool-file-lifetime/*`: seven cases covering original
  header/hash/text close selection, pending reads, exact close-only recovery and
  discovery propagation. Binary headers are inert format data, not platform runs.

The existing cache recipe, CLI preview and actual ZIP descriptor recovery
fixtures were updated to retain their original assertions and add the admitted
Clangd storage lifetime. No fixture/assertion was removed. No test, archive
download, tool installation, native binary, Linux/WSL execution or symlink
creation ran for this checkpoint.

Static format/ESLint, JavaScript syntax, configuration budget and whitespace
checks passed; shared-module analysis found zero cycles. Generated configuration
inventory was refreshed. The publication front gate remains deferred with the
implementation wave; earlier passing runtime receipts do not qualify this source.

#1559 remains open: package dependency closure/qualified build allowances and
other missing recipe work are separate. Real Windows Clangd installation,
observed allocation high-water and actual consumer/protocol checks remain
required under #631. #1574 still has additional custom/legacy ownership adoption.
