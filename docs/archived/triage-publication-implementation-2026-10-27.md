# Coherent triage record generations — 2026-10-27

**Unvalidated source:** `2c05a6a0dfcc95f93c39d682e680aecb9ed0a55c`, tree
`b34f12ca8ef1ffbdb719a027625e8fd005e5e9a6`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Local implementation checkpoint; not pushed or functionally qualified.

#821 previously wrote mutable JSON and Markdown separately. The existing records
indexer could read one update's text and another update's metadata, and conflict
decisions were outside cross-process ownership. Two successful renames alone
could not establish one reader generation.

The producer now holds the existing per-ID cross-process file-lock owner while
checking prior identity, capturing input, staging and selecting a generation.
Different IDs retain independent locks; exact reimports reuse a verified existing
generation. Windows aliases share the key and cannot silently overwrite another
stored record ID. Fallback conflict checks keep their original timestamp policy
and now execute inside the same owned operation.

Both immutable payloads use existing atomic original descriptor/publication
owners and readback. Only their complete generation can be exposed through the
canonical record JSON's strict version-one internal receipt. No derived mutable
Markdown write follows the single selector publication. CLI `mdPath` identifies
the actual immutable source; the guide now documents that path contract. The
exact prior selector is retained, prior immutable payloads remain available,
unknown private namespaces stay protected, and incomplete stages never become
inventory inputs. No automatic generation/evidence deletion was introduced.

Inventory preserves legacy Markdown behavior and recognizes new JSON-only
selectors without enumerating private stages/history. It captures only compact
per-source hash/length/path witnesses, rather than retaining all JSON/Markdown
bodies. The actual indexer rechecks both immutable payload identities when it
consumes them, including after asynchronous warm-bundle admission. Source
references continue to use their existing framing and bind the actual immutable
Markdown path, permitting deferred original-generation reads after a later
publication. JSON-only finding/history consumers retain the original public
record fields and existing full-wire descriptor observations; private bookkeeping
does not enter their returned record body.

Required resource and independent observer failures remain attached to the
existing file-lock/session owner. Explicit metadata recovery cannot repeat
failed record work or relabel its outcome. Internal staged observers have the
same settlement requirement. Input, JSON and Markdown bounds remain distinct
from process memory and whole-store lifecycle/quota qualification.

The strict receipt/schema and pure semantic validator live under `src/contracts`;
the path owner is shared by publication/inventory and the existing CLI re-export.
The shared records producer advances to 10. The
[publication contract](../contracts/triage-record-publication.md) records commit
semantics, layout, compatibility, limits and ownership; #1267 retains common
lifecycle/quota policy.

## Authored checks and deferred acceptance

Sixteen **unexecuted** `tooling/triage/record-publication/*` cases cover controlled
same-ID interleaving, a real separate Node process, independent IDs, stage/commit
failure and corruption, cancellation, stable reimports, captured input, receipt
type/hash/authority negatives, legacy inventory, retained embedding sources,
unknown namespace protection and original pending-resource/metadata settlement.
The real records builder case captures its artifact handoff, checks both text
identity and metadata while publication is held, then changes a source after
inventory to require rejection before index publication. This is not a claim of
native artifact publication acceptance. The separate process is explicitly
hidden, IPC/output/lifetime-bounded and owned through close; its helper runs no
editor, terminal, installer or project command.

Static format/ESLint, changed JavaScript syntax, configuration budget and
whitespace checks pass. Shared-module analysis finds zero cycles. Generated
configuration inventory was refreshed; command inventory generation has no
changes. No functional fixture, process fixture, full index, native compiler,
benchmark or publication front gate ran.

Actual execution of these controls, existing ingest/decision/finding snapshots,
fallback/path negatives, records source/namespace/inventory, fresh/warm bundle,
profile/vector-only, search/context consumers and the full publication front
gate remain pending on the resulting candidate. #821 stays open until all
original and follow-up acceptance is demonstrated. Earlier green revisions do
not qualify this source wave.
