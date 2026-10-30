# Managed command resource ownership

The existing managed command owner retains the selected physical installation
through actual subprocess close and any independent cleanup reported by the
subprocess owner. A timeout, cancellation, exit flag or returned result cannot
substitute for that close observation. The original release observer is invoked
with its original receiver; missing or throwing observers remain unconfirmed.

Pending failures preserve their exact original cause and nonenumerable native
capabilities without mutating the original error. The diagnostic
`managedCommandInstallation` keeps its existing identity fields. Nonenumerable
`managedCommandLease` retains the actual original installation lease, and the
asynchronous invocation also retains `managedCommandSession.releaseAfterClosure()`.
That invocation capability rechecks its original close and independent native
evidence before retrying its exact metadata removal. Copied JSON cannot recreate
it, and unknown native ownership does not become confirmed after metadata removal.

Only an actual producer-branded failure from the held storage session, or the
same command owner's failed metadata confirmation, is excluded from independent
native blockers. Otherwise an owner could wait for its own metadata removal
before invoking the retry needed to remove it. Outward release observation still
requires actual installation lease release. A failed metadata attempt is exposed
for explicit retry and does not rerun the command or acquire a replacement.

LSP constructor failure preserves both original and lease-release errors. Resource
settlement callbacks retain metadata failures rather than throwing them from a
native event. The actual retained client remains the resource authority for later
`releaseManagedInstallation()` attempts. Synchronous command execution retains
unconfirmed timeout/tree ownership and exposes the same exact lease capability.

The shared managed-command fixture now supplies the strict registered archive,
source, ownership, lease protocol and verifier-settlement fields required by the
existing managed receipt contract. Its prior incomplete shape was rejected by
that contract; the consumer authority checks remain strict. The bytes and
verification labels are synthetic fixture inputs, never installation/protocol
qualification. Existing close/timeout negatives remain, with original failures
asserted as exact causes of composed ownership errors.

These source changes and inert direct-child/actual retained-client regressions
are unvalidated. Actual provider/native descendant containment, LSP transport,
installation replacement, platform and performance acceptance remain separate.
