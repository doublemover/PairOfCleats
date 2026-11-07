# Finite plain-object heap versions

Unvalidated first slice of #1509. Immutable versions distinguish world, allocation,
region and caller context. Named cells retain explicit presence; a missing cell
remains unknown. Wildcard writes affect later matching reads, while a qualified
definite overwrite cuts off older wildcard contributions for that named cell.
Branch joins retain both predecessor values and unnamed wildcard remainder.

Strong updates require an admitted proof of one concrete live object, matching
world/region/context, exact property, unconditional write, plain data property and
no concurrent writers. A singleton abstract allocation that represents many
objects cannot qualify. These declarations are upstream trusted model inputs,
not public assertions that a checksum can prove.

`src/semantic/heap-values.js` consumes versions for paged may-value explanations.
Pages never claim concrete paths, feasible execution, vulnerability absence or
no-flow. No existing compiler producer or shared analysis version changes.

## Aggregate admission and immutable operations

The supplied profile retains its 4,096-cell/value/wildcard and 128-predecessor
semantic caps. Separate internal operation allowances admit 8 MiB of logical
input JSON, 8 MiB of output JSON (including version identity), 65,536 candidate
value references and 1,000,000 structural/encoding checkpoints. Inputs sharing
arrays/strings are charged at every logical occurrence. Raw capture uses the
existing passive bounded canonical encoder with the remaining aggregate input
allowance before property maps, branch expansion or old-version cloning.
Operation envelopes reject accessors without evaluating them. Optional omitted/
undefined controls retain their defaults. These are internal data-model resource
allowances, not new CLI/configuration controls or absolute JavaScript heap/RSS.

Owned immutable versions have private weak receipts and property indexes. Their
content identity is reused without rehashing, and the existing domain-separated
version hash remains compatible for accepted payloads. An externally transferred
version must be captured, structurally validated and hash-checked; neither a
matching versionId nor a frozen outer object supplies private authority.
`admitFiniteHeapVersion` returns an owned copy for callers retaining transferred
data across operations/pages. The original mutable object is never blessed by a
prior successful read. World, region, allocation, context and update meaning stay
in the identity, and every operation retains the upstream model-only certainty.

Joins validate each predecessor once, use the admitted property index and bound
all candidate/wildcard union work. A successful join seals its new payload once;
it does not rehash every predecessor for every property. Historical versions and
qualified strong versus weak updates remain immutable. Aggregate/work exhaustion
throws an explicit resource error with operation phase/work evidence. It cannot
publish a narrowed complete answer, pretend no-flow or silently discard values.
Canonical byte exhaustion keeps `ERR_SEMANTIC_JSON_BUDGET`; other operation caps
use `ERR_FINITE_HEAP_BUDGET` with the exhausted allowance. No spill/continuation is
implicitly introduced by either error.

Complete read projections are indexed by admitted content identity and demand.
A bounded LRU retains at most 32 results and 8 MiB of serialized result/key bytes;
it retains no version objects, readers or live source handles. Paged consumers
borrow immutable projections and copy only the requested value page. Public full
reads still return detached value/dependency arrays, so caller mutation cannot
poison later reads. A cache miss admits the complete union independently of the
page size. Internal counters distinguish payload hash encodes/bytes, transferred
admission, owned identity hits, cache reuse and actual cell/wildcard/value visits.
Logical inputs, output/canonical temporaries, property indexes and cached read
metadata are separate scopes; their byte allowances are not process high-water
measurements or an assertion that all phases share one physical allocation.

OwnedHeapVersion means a privately admitted immutable profile payload, not a
compiler-produced language heap or trusted uniqueness proof. Serialized profile
payloads remain unowned until admission. A read projection is a complete bounded
may-value answer within that supplied model. Budget errors are atomic resource
frontiers and do not make the model source-complete.

New authored controls cover shared-reference rejection before projection/clone,
tiny aggregate/candidate limits, whole-union admission beneath a one-item page,
bounded cache retention, owned multi-page and multi-predecessor work, exact legacy
hash/answer parity, transferred/frozen-outer tampering, accessors and sparse input.
Original historical/strong/weak/wildcard/context/no-flow assertions remain. These
fixtures and representative sparse/dense timing/GC/heap qualification are unrun.

This finite materialized pilot does not implement compiler CFG extraction,
getters/proxies/native effects, interprocedural alias analysis, dynamic solver
subscriptions, retained version stores, trace/risk publication or incremental
SCC retraction. Capacity rejection is explicit and atomic; it does not itself
provide spill or durable continuation. Those integrations and the independent
concrete-oracle/benchmark campaign remain open. Fixtures are authored, not run.
