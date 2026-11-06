# Exact evidence delivery

The delivery core implements pure full-pack manifests, delta planning and exact
reference reconstruction for already-admitted evidence. It reads no private
sessions, executes no providers and grants no source/transport authority. The
initial world envelope reuses the indexed question world's canonical repository,
generation, source inventory, context, domain and producer identities. Existing
CLI/MCP/HTTP clients continue receiving self-contained results.

Each window binds one consumer/session, context epoch, window revision, task
revision, branch, scope, policy and world. Entries separately bind immutable
observation IDs, exact representation bytes, source coordinates, logical roles,
qualifications and dependency IDs. Identical paths or text cannot merge distinct
origins or contradictions. Exact source entries preserve complete Unicode scalars
and their original UTF-16 interval. Synopsis/navigation/answer representations
cannot claim an exact source interval or satisfy an exact-source role.

`buildEvidenceWindow` produces an ordered immutable manifest and complete bodies.
Missing exact-source roles remain unresolved. Original unresolved requirements
and opaque producer continuations survive unchanged. Required content is never
truncated to meet a budget. Both cardinality and complete encoded reconstruction
are bounded by the existing 128 KiB response ceiling.

`planEvidenceDelivery` accepts a privately issued current-window witness. A JSON
manifest, copied receipt or caller-supplied visibility flag cannot construct that
witness. The internal witness owner is for a trusted host integration that has
already checked its actual committed window; it performs no authentication or
source admission by itself. A new issue/reset revokes its old witness and retains
only the current bounded window. The host integration below owns commit/ACK;
no third-party client is declared qualified.

Delta suppression requires the exact expected digest, next window revision and
matching consumer/session, epoch, task, branch, policy, scope and world. Unknown,
reset, stale-world, cross-consumer or unsupported bases get a full pack. The full
packet explicitly invalidates reuse of the prior window, without changing
canonical retention or semantic truth. Delta operations partition the target into
retained/added representations and explicitly evict unavailable window entries.
Changed roles, qualifiers, origins or representations have changed identity.

`applyEvidenceDelivery` stages reconstruction from the exact base. It checks
packet identity, complete membership, every supplied body's source/representation
descriptor, target digest and complete cost. Missing bodies and dishonest retained
entries fail. Reapplying an exact target is idempotent, but corrupted packet bodies
still reject. Applying a packet establishes reconstruction integrity, not current
visibility, comprehension, truth or permission to act. Only a compatible host can
attest its actual committed context.

Wire bytes and complete reconstructed bytes are measured separately using the
canonical JSON renderer plus newline. Small deltas cannot bypass the full-window
ceiling. Instruction/tool overhead, reserved completion and full prompt tokens are
outside this pure renderer; full-prompt bytes/tokens are explicitly unknown. No
token savings, latency improvement or host prompt guarantee is claimed.

Six unexecuted pure cases cover full source/role manifests, 256 independent full/delta
subset reconstructions, consumer/reset/scope isolation, loss/order/eviction,
corrupt maps and packet bodies, Unicode, full-cost bounds and cancellation. A
public full-pack transport, shared hydration and workload qualification remain
before issue #1533 closes.

`createEvidenceDeliveryHost` takes installed boundary, provider and exact-window
adapter functions. The boundary binds consumer identity out of band and rechecks
epoch/task/world/scope/policy before and after work. A request cannot name another
consumer. Provider selection uses a closed schema; bodies and checked claims are
not request fields. There are at most sixteen consumer states, one current pending
packet each and 4 MiB of charged pending plan/selection/reconstructed-window bytes.
Native provider errors retain their original observations and block another
attempt until actual settlement. No source handle survives in a pending window.

Sending/planning a packet never advances visibility. `apply(packetId)` looks up
the exact bound pending packet, revalidates its original selected evidence, stages
the complete window and calls the host's atomic compare-and-replace. Exact
readback and current revision checks precede the receipt and new witness. False
replacement success, conflicting windows and stale packets cannot ACK. Redelivery
preserves packet identity; lost ACK delivery can reconcile the exact already
committed target. Reset/compaction requires the actual host to change its epoch.

The reference memory adapter owns one actual canonical JSON pack window per
consumer. Its receipt says `host-owned-pack-window`, with prompt tokens unknown;
it does not attest an external model prompt. Ordinary clients cannot submit an
ACK flag to manufacture this receipt. This is an integration seam, not a new
authentication or credential service.

The live answer provider executes the existing pinned query/quotation coordinator.
It delivers the complete qualified answer and explicitly selected source quotes,
with separate origins and logical roles. ACK/redelivery verifies the exact
delivered binding records, selected witnesses, compilation, inventory/domain and
retained quotation bytes through existing readers. It does not rerun a query whose
time boundary could produce a different page or substitute a new cursor. Count
and negative dependencies remain conservatively bound to the complete immutable
inventory; no new program-wide completeness assertion is made. Source expansion
has a 250 ms verification interval and confirmed original cleanup before ACK.

Seven additional unexecuted host cases cover identity/reset and consumer isolation,
lost/reordered packets and ACKs, permission/source changes, cancellation/pending
original work, atomic replacement/readback, the actual query/source provider and
falsey verifier-close failure. Corrupt retained quotation bytes fail before a host
window can be acknowledged. Source roles are selected labels, not proofs of their
semantic sufficiency.
