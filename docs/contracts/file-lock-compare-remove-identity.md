# Lock compare and removal identity

Status: UNVALIDATED source implementation and authored consumer regressions.

Generic async/sync lock removal reads a strict internal metadata record through
the existing descriptor borrower. Parsed metadata and exact BigInt stat identity
belong to the same completely read, verified and closed descriptor. A completed
corrupt JSON file may still be eligible for explicit force cleanup; an unreadable
or unclosed file supplies no such evidence. Public diagnostic `readLockInfo`
retains its ordinary null compatibility without granting removal authority.

After the existing logical-owner/resource-settlement check, removal revalidates
the current single-link ordinary pathname's device/inode, mode, size,
modification/change/birth times and process-local publication fence immediately
before invoking the existing removal syscall. A replaced or changed file returns
false without removal, including a replacement containing copied logical owner
IDs and identical bytes. Original pending native errors remain unsuppressible;
nonvoid removal results cannot claim successful cleanup.

Actual acquisition carries its observed exact identity into stale removal.
Baseline/current reads and any existing force fallback must still match that
identity. Ownerless stale recovery cannot adopt a new valid owner, and a newly
settlement-marked record stays protected. No extra retries, namespace, PID census
or serialized capability are introduced; the expected-identity data is a
comparison prerequisite within the existing owner, never a deletion capability.

`tests/shared/locks/file-lock-compare-remove-identity.test.js` authors actual
async/sync owner/force consumers with replacement after confirmed descriptor
close, in-place edits, copied owner bytes, unreadable versus corrupt metadata,
nonvoid removal, settlement-marked controls and the actual acquisition-to-stale
handoff. The internal synchronous JSON borrower requests matched exact stats only
for destructive record consumers; ordinary diagnostics add no extra stat calls.

The final pathname comparison and unlink/removal remain separate portable
operations. An unrelated writer can still replace a name in that final syscall
window; this change does not pretend to supply atomic compare-and-delete,
cross-process exclusion or extra authority. Native Windows locked-file, physical
alias, coupling/performance and broader storage qualification remain deferred.
