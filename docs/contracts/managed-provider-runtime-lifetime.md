# Managed provider runtime lifetime

Status: **UNVALIDATED source integration** for #1146–#1148. No fixture, binary,
protocol, formatter, syntax check or gate was executed for this source release.

Runtime consumers use `src/shared/managed-installation.js` as their sole
installation retention owner. A selected-install locator or prior version probe
does not retain an installation. Before a managed command runs, its exact
physical `installId`, recipe `descriptorId`, command and current selection must
agree with the canonical byte inventory under the owner's category and
installation leases. A repaired sibling has a distinct physical identity even
when it uses the same recipe. Stale or damaged managed paths fail admission.
Unmanaged commands retain the existing execution/trust policy.

Pooled and unpooled LSP sessions and initialize probes retain the selected
installation before creating their runtime client. A pooled session keeps the
lease through idle reuse and transport restarts. The client records every
spawned handle, including malformed injected transports, and keeps actual close
separate from process exit. Its settlement evidence also includes pending or
failed tree cleanup. Teardown releases only when that exact client confirms
resource settlement. An unconfirmed disposal keeps ownership; a later actual
close can reconcile it. A released client cannot spawn another transport.

JSONL providers wrap the existing shared subprocess owner. Normal completion
requires actual child close; cancellation and timeout retain the lease until
close and that owner's cleanup predicate agree. The wrapper does not implement
another kill-tree algorithm or release on elapsed time. Synchronous version/help
probes use the shared synchronous retain API. A normal status drains stdio and
reaps the direct child. A synchronous timeout or unqualified tree-cleanup result
keeps `cacheOwnershipPending`; it does not become successful teardown, and no
subsequent probe attempt is launched by that probe loop. Resolving such an
unconfirmed synchronous tree remains an execution-owner obligation.

`tooling/lsp/managed-session-installation-lifetime` and
`tooling/providers/managed-command-settlement` are authored regressions using
real canonical file/lease owners with synthetic installation receipts and
transport/settlement events. They cover idle pooling, original installation
identity, exit-before-close, restart after release, stale selection, byte drift,
delayed cancellation close and unresolved synchronous timeout. They do not
qualify an executable, an operational installer, protocol compatibility, native
descendant lineage, platform behavior or a published consumer run. Broader
language provisioning and runtime closure work remains partial.
