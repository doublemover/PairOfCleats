# Finite revision oracle

The closed offline adapter `finite-positive-support-revisions-v1` supplies the
first bounded cross-revision profile for #1528. It drives the existing positive-rule
view owner and compares each result with a fresh build and an independent finite
reference. It accepts data records, never generated commands or candidate code.

Scenario and execution contracts live in
`src/contracts/schemas/revision-oracle.js`. Scenarios retain the supplied world,
fixed definition, generator family/seed, exact support-origin identities and
ordered edits. Every edit binds the original before-state hash and independently
realized after-state hash. All edits are checked before candidate work; stale
hashes, absent removals, reused origins and unsupported profiles are refused.
Input capture rejects accessors and unknown fields. This profile allows no source
references and makes no current source-authority claim.

The model is limited to sixteen facts, twelve intensional Boolean facts, thirty-two
positive conjunctive rules, sixty-four extensional supports and sixteen edits.
Duplicate supports for one fact retain separate origins. Membership is Boolean;
provenance is the bag of direct producers, including duplicate rule bodies and
support multiplicity. It is not the bag of all derivation paths through a recursive
program. Anti-join, negative dependencies, compiler/source revisions, mutable heap,
storage/reload and test-selection adapters remain outside this first profile.

The reference enumerates all intensional valuations with the exact supplied
extensional membership, then intersects every Horn-closed valuation. It does not
import candidate extraction, fixedpoint, propagation or support hashing. Direct
producer terms are reconstructed from the resulting model and compared with
multiplicity and original origin identities. Independently checking that declared
finite model does not establish the correctness of a source-to-model frontend.

Each checkpoint records separate candidate/rebuild execution IDs, root and output
identities, independent and differential claims, work counters and separate phase
timings. Fresh-build equality cannot establish independent correctness. Incomplete
candidate output or exhausted reference enumeration yields unknown. A run preserves
every declared checkpoint, including not-run rows after a work/output stop. Default
execution allows 1,000 ms, 4,096 valuations per reference and 256 KiB of receipts;
callers may only tighten work bounds. No runtime/performance result is claimed from
these limits. Cancellation propagates without a successful execution handle.

Private original handles own completed runs. Inspection cannot adopt copied
receipts; retirement drops the retained scenario/run. The diagnostic data comparison
API deliberately creates no qualified execution receipt.

Revision-deletion minimization requires an actual independent disagreement from
the original run. It keeps the original scenario and named checkpoint/fact
predicate. Every proposed deletion rechecks transition preconditions and re-executes
the registered owner/reference. Unknown, unsupported or invalid proposals cannot
replace the reproducer. Attempts are bounded to sixty-four and 1,000 ms; this is
revision deletion, not a claim of globally minimal source or program behavior.

Seven authored, locally unrun fixture cases cover deterministic families and seeds,
simultaneous inputs, duplicate supports, recursive seed removal/re-addition, stale
preconditions, original handles, cancellation, explicit unknown outcomes and
minimization. Seeded diagnostic defects must be detected while corrected outputs
pass. The minimizer's injected finite boundary control tests its decision logic;
it does not claim the real positive-rule owner currently fails.

The `finite-relational-revisions-v1` adapter additionally drives the original
[join/anti-join cohort](relational-join.md). It supports eight original supports
per input, eight copies per support and sixteen exact-hash edits. Its reference
recounts the complete contribution history, expands tiny occurrence bags and
compares exact endpoint/parent multiplicities and captured-domain observations.
It imports no candidate arrangement, coefficient or delta helper. Fresh relation
content is compared separately; private transition ledgers legitimately give
different view roots. It does not normalize the actual relation content away.

Scenario/receipt contracts are in `revision-relational.js`. Reference pair work is
bounded to 4,096 per checkpoint and cooperative execution to 1,000 ms. Exhaustion
is unknown even when rebuild parity passes. Receipts retain all checkpoints and
at most the first full independent counterexample, with exact output hashes and
failure outcomes for subsequent disagreements, under 256 KiB. Diagnostic data
comparison does not create an original execution handle. Six additional authored,
unrun cases cover actual registered operators, seeded cross-term/threshold and
origin/multiplicity defects, stale worlds, unknown and handle retirement. This
profile has no source materializer or durable publication. Both finite profiles
share the bounded revision-deletion engine. Relational minimization requires the
same named checkpoint's independent bag disagreement; positive-rule minimization
additionally preserves the named fact. Every proposal runs its original registered
candidate/reference and retires its temporary execution handle. Unknown, invalid,
corrected or different failures cannot replace the witness. One additional authored,
unrun finite boundary control exercises these decisions without forging a production
execution or claiming either current candidate fails.
