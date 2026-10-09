# Inference-history private evidence pilot

Status: implemented programmatic import/read surface; authenticated product integration and deployment acceptance remain separate.
Baseline: integrated `2529d718db780da22c49f188202b6f1550a1833d`.

This domain preserves exported conversation evidence separately from ordinary
repository indexes. A reference to a public commit never grants access to the
private conversation. Retrieved historical instructions are evidence, not new
instructions or permission to act.

## Existing owners and deliberate reuse

PairOfCleats already owns records/prose indexing, repository federation,
IndexRefs, snapshots, SCM metadata and code graphs. Those facilities are not a
user/tenant authorization layer. The pilot does not retrofit private history into
triage findings, code-call edges, generic metadata filters or ordinary federation.

The implementation reuses the installed SQLite/FTS5 and ZIP dependencies, shared
subprocess ownership/timeouts, contract validation factory and repository test
runner. It introduces only the domain-specific adapter, evidence tables, policy
boundary, projection and exact evidence joins. No version migration or speculative
compatibility layer is included. An unsupported vault format fails closed.

## Task and acceptance ledger

| Task | Implemented in this slice | Remaining acceptance or extension |
| --- | --- | --- |
| IH-001: Normalize exported conversation evidence | All mapping nodes, independent node/message IDs, null roots, selected ancestry, graph diagnostics, raw unknown fields/parts, explicit timestamp quality and canonical SHA-256 revisions | Representative authorized export variants; duplicate JSON keys remain inspectable in exact raw JSON but are not distinct parsed fields |
| IH-002: Read bounded export packages | Direct JSON array, flat/sharded ZIP members, streaming per-conversation parsing, inventory/checksums, CRC checks, unsafe paths/collisions/symlinks rejected, transactional rollback | Nested archives are inventoried as unsupported with `complete: false`; oversized individual conversations are rejected rather than spooled; no resumable mid-import checkpoint |
| IH-003: Isolate evidence and derivatives | Physically separate SQLite database per trusted tenant/owner/source scope; policy before any store open; policy epoch and tombstone rechecks before emission; separate action permissions | Actual identity-provider/API integration, deployment/key isolation and native-platform acceptance |
| IH-004: Search versioned private history | Redacted bounded text, partition-local FTS5 statistics, exact source references, selected/alternative paths, import/node reuse, metadata-only invalidation and original-read permission | Engineering selection UI, ordinary retrieval-backend integration, qualified vector/media retrieval |
| IH-005: Correlate authorized code evidence | Exact Git object verification, ambiguous/unresolved SHA retention, separately authorized Markdown task/commit mentions, content revisions, independent code-policy rechecks | Hosted PR/task events, dated branch observations, patch equivalence and reviewed inferred relationships |
| IH-006: Exercise privacy lifecycle | Synthetic cross-user/org/tenant negatives, in-flight revocation, deletion tombstones, source/derivative row removal and explicit retained-source limits | Small private sample, full archive, backup-restore deletion ledger, complete erasure/deployment audit |

The tests establish this bounded implementation surface, not production-ready
shared hosting, a full release gate, performance/quality measurements or a real
export's completeness. The canonical project execution queue remains
[the roadmap](../roadmap.md).

## Programmatic boundary

Owner: `src/integrations/inference-history/service.js`.

`createInferenceHistoryService` accepts:

- `vaultRoot`: an explicitly provisioned private directory outside Git repositories
- `resolveAccess`: trusted authentication/authorization callback
- `resolveImportSource`: trusted upload/source authorization callback
- `resolveCodeAccess`: separate trusted callback for optional code correlation
- `verifyPrivateVault`: host ACL verification required on Windows
- `limits`: positive integer overrides for documented resource caps
- `audit`: required trusted protected sink acknowledging `{persisted:true}` before evidence release; events contain authenticated scope, bounded credential-redacted query/settings, opaque references and outcome, never archive bodies or source paths
- `semantic`: optional frozen local model/index adapter; default auto uses lexical without it
- `resolveOwnerAccess`: separate trusted human-channel authentication for owner inventory and privacy actions

The methods are `importExport`, `search`, `readContext`, `readTimeline`, `readReferences`, `readOriginal`, `readMemberEvidence`, `correlate`, `deleteRecord`, `ownerInventory` and `ownerSetPrivacy`. They all accept an opaque `requestContext` and a `partition`
selector. The selector, archive fields and retrieved text cannot supply identity.

The host's `resolveAccess({requestContext, partition, action})` must authenticate
the session and authorize the entire physical partition for that exact action. It
returns the strict registered `inference-history-access` contract:

- `allowed: true`
- authenticated `principalId`
- `tenantId`, `ownerType` (`individual`, `organization`, or `collection`), `ownerId`
- originating `sourceScope`
- current `policyEpoch`

Missing/invalid policy, callback failure, changed identity or changed epoch denies
the operation. Repository membership, infrastructure administration and organization
membership have no implicit history grant. The trusted adapter must decide grants
and expiry explicitly. A callback returning request-supplied owner/tenant fields
would violate this contract. There is intentionally no permissive default adapter.

Imports take an opaque `source` selector. `resolveImportSource` authenticates that
source independently and returns its approved absolute `path` and current
`policyEpoch`. A caller-supplied `sourcePath` is never opened. Source authorization
is rechecked before commit, preventing an import grant from becoming arbitrary
server-filesystem read access. The host must map only authorized uploads or
explicitly granted local files, without passing through client paths.

One partition is one authorization/ranking unit. A host needing narrower audiences
must create distinct partitions; it must not claim per-node ACL enforcement by
filtering returned top-k hits. No result/vector/query cache is shared between
partitions, and logical IDs include the partition namespace.

The service is not mounted into CLI dispatch, HTTP, MCP or workspace federation.
Before exposing it, implement authenticated adapters and test their transport
schemas, filesystem authority and every supported derivative path. The internal
JavaScript library does not sandbox another program running as the same OS user.

## Filesystem and deployment boundary

The host provisions the vault; the service never falls back to a repository cache
or creates a private store inside a source checkout. On POSIX, the vault must have
no group/other access, and database files are created with mode 0600. Symlinked
vault paths, database links, hardlinked database files and unsafe SQLite sidecars
are rejected. Windows requires an explicit trusted ACL-verification callback and
must be verified by the deploying host; synthetic fixtures do not verify real vault ACLs.

The host must protect the vault, its ancestors and authorized repository paths
from concurrent malicious filesystem mutation. Final-component no-follow and
path/inode checks reduce substitution risk; JavaScript pathname operations are
not a capability-secure filesystem sandbox against a same-user attacker. Git is
invoked read-only with bounded owned subprocesses, no ambient Git directory
overrides, replacement objects, pagers, textconv, network requests or shell command
construction.

Encryption, keys, backup isolation and protection from privileged host operators
are deployment responsibilities and are not implemented by SQLite file modes.
Keep raw exports, vaults and their backups outside all ordinary code-index roots.
Never publish private fixtures or raw vault files to the repository.

## Archive and evidence contract

Supported ZIP shard basenames are `conversations.json`, `conversations-<digits>.json`
and `conversations_<digits>.json`, including directory prefixes. Each shard must be
a UTF-8 top-level array of conversation objects. An initial UTF-8 BOM is accepted;
other JSON syntax remains strict. Input is read only; no archive member is
extracted or executed. Unknown members are inventoried with size and SHA-256.
Nested archive bytes are hashed but not opened, and their presence makes coverage
incomplete. Media bytes are not decoded, stored separately, fetched from URLs or
sent to model providers.

Default caps:

- 256 MiB archive; 512 MiB expanded bytes; 128 MiB per member
- 8 MiB per conversation; nesting depth 128
- 10,000 entries; 10,000 conversations; 10,000 nodes per conversation
- 100,000 processed units; 32,768 characters per text projection
- 30 seconds per import; ten seconds for bounded code correlation

Oversized, corrupt, malformed or interrupted imports roll back as a unit. The
original archive remains caller-owned. The vault retains exact conversation JSON
substrings, their byte-equivalent UTF-8 hashes, semantic canonical hashes, source
member/ordinal occurrences and the member inventory. Both `raw` and `rawJson` are
available only through `read_original` authority. `rawJson` preserves duplicate
keys and formatting that JavaScript's parsed object cannot represent separately.
Byte-distinct JSON creates a distinct snapshot even when canonical objects match;
unchanged normalized units are shared across those snapshots. Vault format
inference-history.v7 includes the required lookup indexes and private reference key.
Older vault formats fail closed and are not migrated or modified implicitly.

Conversation identity includes trusted source scope and source conversation ID.
Node revision identity includes the mapping key and canonical raw node payload,
not just text. Conversation snapshots own path membership; changing a selected
leaf or title does not require recreating unchanged node projections. Projection
identity includes the adapter version, projection version and character budget. A changed transform
must change that version. Reimporting identical bytes under the same transform
does not add versions. A later incomplete export does not delete old evidence.
Conflicting snapshots for the same conversation in one import fail rather than
selecting an arbitrary last shard.

Parent-only trees derive normalized child lists from explicit parent relationships;
raw source fields are unchanged. Declared child arrays still undergo mismatch
validation. Adapter revision chatgpt-export.v7 invalidates earlier import transforms.

Graph validation preserves malformed evidence while reporting missing/dangling
references, inconsistent edges and cycles. Invalid selected ancestry is `unknown`;
no longest-path fallback is labeled selected. Unknown roles/content remain raw
evidence. No assistant claim becomes verified repository state merely by import.

Asset references stay `unresolved`. Original-read output provides their exact
pointers and the checksum-bearing archive inventory; the pilot does not infer
asset identity from a filename, opaque pointer or similar-looking image. Code
parts remain ordered raw evidence; hidden code payloads do not participate in visible text retrieval.

## Projection and retrieval

Projection history-text.v7 retains canonical node revisions privately. Public
projection metadata contains a digest of redacted, clipped text only. Search and
context never expose raw text, raw occurrence or node revision hashes. Content-dependent
snapshot, unit and group references are HMACs under a random per-vault key held in
private vault metadata; predictable private text cannot be verified from these references.
Conversation and Codex searchable projections use the same public text admitted by
the visible reader; exported turn dates remain available to date filters.
Reused normalized nodes count toward the import unit limit. Candidate counts stop
at 1,001 to signal an incomplete result beyond the 1,000-unit read budget.
Candidates are materialized before BM25 ordering, so ranking examines at most 1,000
rows. Provenance location queries materialize at most 1,001 rows before sorting;
indexed occurrence queries likewise return at most 1,001. Search and reference reads
admit at most 1,000 locations and 1,000 occurrences in total, failing with
ERR_INFERENCE_HISTORY_LIMIT before expanding an oversized result. These bounds
apply before pagination; a small page does not authorize unrestricted expansion.
Message-ID and snapshot occurrence indexes support bounded exact lookups.
Coverage counts and date bounds are maintained transactionally in one statistics row;
search reads that row instead of aggregating the corpus. Date indexes support extrema
updates after deletion. Turn-level visibility restrictions also gate Codex items.
Git object discovery must resolve to the exact authorized root. Imports containing
tombstoned records remove their newly collected member evidence and links.
Original reads do not apply current ingestion limits; optional asset extraction uses
fixed read bounds and reports assetReferencesComplete=false when those bounds are exceeded.
Bare Git repositories are rejected alongside worktree repository locations. Each query unit records its UTF-16 character
budget, original/redacted/projected lengths, truncation flag and deterministic
trim counters/reason. Full raw evidence remains subject to original-read authority.
Clipping preserves surrogate pairs; no archive or text cap is increased.

Redaction runs over complete extracted text before clipping. It masks common API
token forms, private-key blocks, bearer values, credential assignments and
credential-bearing URL parameters. Exact Git OIDs are retained. This is a
high-confidence accidental-disclosure reduction, not a proof that arbitrary
private content is sanitized for publication. Search titles/metadata are separately
bounded and redacted; raw timestamps, arbitrary payloads and attachment metadata
never enter query output.

Search accepts literal Unicode word terms, ANDs them safely, and caps query length,
term count and top-k. It returns bounded text and opaque conversation, snapshot and
source references. `pathState` supports `all`, `on_selected_path`,
`off_selected_path`, and `unknown`. Default results use the latest imported
snapshot; `includeHistory` retains earlier versions, and `snapshotRef` selects an
exact retained snapshot. Shared unchanged nodes are not duplicated merely because
they occur in multiple snapshots. Every hit says `instructionAuthority: none`.

No embeddings, summarization, OCR, transcripts, automatic external asset loading
or remote processing are enabled. The existing records full-body embedding and
sidecar invalidation issues are not bypassed by claiming those paths were fixed;
this isolated slice does not use that builder.

## Correlation and permission inheritance

`resolveCodeAccess` supplies a policy epoch plus at most eight authorized repository
IDs/roots and up to 64 explicit Markdown paths per repository. Those inputs come
from the trusted host, not the archive or query payload. Its authorization is
rechecked separately from history access before returning relationships.

Git references are verified against local objects. A hexadecimal prefix must
resolve uniquely to an actual commit. The result retains repository identity,
full OID, tree, parents, author/committer dates and a bounded subject. An unresolved
prefix remains unresolved. An exact object join says `implementationClaim: false`:
it proves a mention refers to an object, not that the object implemented intent.

Markdown joins require an exact task-style identifier or commit mention. They
return the authorized path, line, current file-content hash and bounded excerpt.
They are working-tree observations, not historical branch evidence. Time proximity,
similarity, branch names and patch equivalence are not silently promoted to exact
joins. Correlation results are transient history-restricted derivatives. A code-only
caller cannot ask the service whether a private conversation references that code.

## Deletion and revocation

Each operation obtains policy before opening any partition and rechecks it before
response emission. Imports/deletions also reauthorize immediately before commit.
In-flight search/original/correlation output checks source tombstones, so deletion
does not depend on a host policy-epoch change.

Deletion tombstones a logical conversation and removes its raw snapshot, occurrence,
unit and FTS rows. Reimport cannot resurrect that namespace. The result explicitly
reports that the caller's original archive and external backups remain outside
this operation, and that import-level inventory is retained. It does not promise
forensic erasure from storage snapshots or erase another tenant's copy. A future
backup restoration path must apply the deletion ledger before serving restored
content. Publishing sanitized decisions needs a separate explicit review and
permission-change workflow; no such publication operation exists in this slice.

## Focused validation

Run the bounded synthetic group:

```text
node tests/run.js integrations/inference-history --lane all --timeout-ms 30000
```

The group covers graph fidelity, dangerous JSON keys, archive CRC/path/size controls,
scope isolation, policy rechecks, private storage paths, projection limits/revisions,
metadata-only updates, incomplete snapshots, in-flight tombstones, exact Git/Markdown
joins and unresolved evidence. No real private export is present in the fixtures.


## Codex records and declared member evidence

`chatgpt-export.v7` uses vault format `inference-history.v7`. The current API exposes
`recordRef` and `deleteRecord`; retired conversation-only storage and API names are
not accepted. Conversation and Codex task IDs occupy distinct evidence-kind namespaces.
`codex.json` tasks retain their original IDs, archived state, ordered turns, previous-turn
references, input/output item structure (including omitted or explicitly null item arrays), branch and pull-request/status fields. Known text
and code enter bounded redacted search projections. Unknown item payloads remain raw
original evidence; attachment pointers remain unresolved. Tasks have unknown selected paths
and missing timestamps unless exported explicitly; no conversation leaf is fabricated.

`export_manifest.json` and `conversation_asset_file_names.json` retain exact raw JSON behind
original-read authority through `readMemberEvidence`. Declared relative archive-member paths
are checked against the checksum inventory and reported as `linked_member`,
`not_in_selected_input`, or `size_mismatch`. These links grant no filesystem or instruction
authority and never cause external files to be opened. Coverage is always `selected_input`;
missing declared members prevent a complete result. Deleting a record prunes shared member
metadata for its imports, along with its snapshots and units, while preserving tombstones.

## Observed Pages export coverage gap

A separately approved read-only Pages dump contains per-page `metadata.json`,
`content/current.json`, `content/history/*.json`, `content/checkpoints/*.json`, and
`relationships/*.json`. Metadata supplies `page_id`, owner/creator IDs, namespace, home,
document type and timestamps. Current content supplies head revision/checkpoint/sequence
identity and a projection with title, preview and `materialized_search_text`.
These are distinct page content and revision evidence, not conversation records.
Embedded `https://chatgpt.com/space/page_*` links are observable in projected text.
Conversation or attachment relationships must be preserved only when explicitly present in
relationship records or content; none may be inferred from page proximity or filenames.
The present archive importer does not ingest this directory export or claim Pages coverage.
A Pages adapter needs bounded parsing, exact raw provenance, separate page/revision identities,
explicit link validation, and the same private original-read and deletion policies before use.

## Visible reading and exact shared-branch groups

`search` now returns bounded match-centered snippets. Its envelope declares literal
Unicode word tokens joined with AND, BM25 ordering, `semanticMatching: false`, actual
persisted import/record/unit counts, stored unit date bounds (including unknown dates),
and unknown export cutoff/full archive window. Empty hits establish no visible matches
in selected input under the supplied filters; they do not establish never-discussed.
Optional `role` is `user` or `assistant`; `dateFrom`/`dateTo` accept UTC dates or ISO
seconds/milliseconds ending in Z. Existing path/snapshot/history filters still apply.
`top` defaults to 10 (maximum 100), `offset` defaults to 0, and `snippetChars` defaults
to 600 (80..2000). Candidate scans stop at 1000 stored units and 64 MiB of raw snapshot
JSON per read; totals are null with `complete: false` when the candidate cap is exceeded.
`candidateMatches` includes candidates subsequently excluded by public visibility;
`totalMatches` counts exact displayed groups, and `totalMatchedUnits` counts their
matching source units. `nextOffset` pages observed groups, not unseen candidates.

Conversation derivatives require public user/assistant messages, an absent/final/commentary
channel, no tool recipient and no hidden flag. ChatGPT content must explicitly be
text/multimodal_text; only string or explicitly typed text parts enter the view. Codex
items must explicitly be messages with a single public role per turn. Reasoning, tool
items and code payloads remain available only through explicitly authorized original
reads. Every returned excerpt is evidence with no instruction authority; assistant
proposals remain labelled assistant evidence and are not implementation claims.

`readContext({sourceRef, snapshotRef, before, after, top, messageChars, offset})` needs
separate `read_context` authority. It follows the snapshot's selected ancestry; for an
off-path hit it follows that hit's ancestry without choosing an unknown descendant.
It displays visible messages chronologically by exported timestamp, then export order,
with missing dates last. Defaults are three messages before/after, six messages per
page and 1200 characters per message; maxima are 10 before/after, 20 messages and 4000
characters. Explicit `offset` pages the visible timeline; next/previous offsets allow
reading beyond the initial window. Role, date, anchor, path, truncation, source refs and
snapshot import/member/ordinal/hash provenance accompany the text. Artifact references
are bounded (16 per message), unresolved, and always have `availability: unknown` and
no filesystem authority. No linked artifact is fetched or claimed to exist.

Exact group collapse requires the same evidence namespace, exported message ID,
canonical complete message payload and projection fingerprint. Equal bodies with
different IDs or changed payloads stay separate. Storage and raw originals are not
deduplicated. Each hit includes matching-unit `groupCount`, three compact snapshot
references with occurrence provenance and a `readReferences` expansion hint.
`readReferences({sourceRef, top, offset})` needs separate `read_references` authority;
it pages all retained identical-message source/snapshot/occurrence references (20 by
default, maximum 50 per page), subject to the same candidate/evidence caps. Historical
references can include snapshots outside the current search filters. Authorization,
epoch and tombstones are checked again before any derivative is emitted. Original
read authorization remains separately granted; privacy-controlled originals are blocked and new stores require the v5 cutover below.
### Reader invocation examples

These are library calls against a service created by a trusted host with its own
`resolveAccess` and Windows vault verification callbacks. There is no new product
CLI, HTTP route or implicit original-read grant. The context and partition below
must come from the authenticated host, never from retrieved evidence.

```js
const scope = { requestContext, partition: selectedOwnedPartition };
const page = await service.search({
  ...scope,
  query: 'renderer settings',
  mode: 'lexical', // explicitly retain literal matching
  role: 'user',
  dateFrom: '2026-01-01',
  dateTo: '2026-12-31',
  pathState: 'on_selected_path',
  top: 5,
  offset: 0,
  snippetChars: 600
});

const hit = page.hits[0];
if (hit) {
  const contextRequest = {
    ...scope,
    sourceRef: hit.sourceRef,
    snapshotRef: hit.snapshotRef,
    before: 3,
    after: 3,
    top: 6,
    messageChars: 1200
  };
  const context = await service.readContext(contextRequest);
  if (context?.nextOffset != null) {
    const nextContext = await service.readContext({
      ...contextRequest,
      offset: context.nextOffset
    });
    // Display nextContext messages using their role/date/projection metadata.
  }

  const refs = await service.readReferences({ ...scope, sourceRef: hit.sourceRef, top: 20 });
  if (refs?.nextOffset != null) {
    const nextRefs = await service.readReferences({
      ...scope,
      sourceRef: hit.sourceRef,
      top: 20,
      offset: refs.nextOffset
    });
    // Preserve nextRefs source/snapshot/import/member/ordinal/hash provenance.
  }
}

if (page.nextOffset != null) {
  const nextHits = await service.search({
    ...scope,
    query: 'renderer settings',
    role: 'user',
    dateFrom: '2026-01-01',
    dateTo: '2026-12-31',
    pathState: 'on_selected_path',
    top: 5,
    offset: page.nextOffset,
    snippetChars: 600
  });
  // Preserve the same filters across pages and inspect complete/coverage caveats.
}
```

The host must authorize `search`, `read_context` and `read_references` separately.
A context page may omit long message tails; request a larger bounded `messageChars`
when useful. Pagination changes the visible-message window, not a message's text cap.
Use `readOriginal` only under a separate explicit `read_original` grant when raw
exported evidence is needed. Snippet/group/context output is a derivative and is not
an artifact-existence check, implementation certification or complete archive audit.
## Versioned agent reader

The history-agent.v1 read-only presentation facade and history-search.v2 query contract are documented in [agent tool usability](../guides/agent-tool-usability.md). Strict matching retains lexical AND; explicit relaxed and facade-default auto support bounded lexical relaxation while preserving phrases, exclusions, role/time/path/snapshot filters and the existing service authority. The old survey remains pinned separately. A separately provisioned trusted local adapter can supply semantic candidates and reranking; no dense archive index is built and no network/model fallback is introduced.

Generation/context cutover: new stores require inference-history.v7 with transactional generation counters and opaque generation references. Import changes and first-time tombstones advance the counter; repeated identical imports do not. Continuations and citation actions pin the generation. Concurrent changes fail closed with ERR_INFERENCE_HISTORY_STALE. Previous store formats are rejected without mutation or migration; the old survey uses its unchanged old source. No production reimport is authorized by this source implementation. Export completeness/freshness remains unknown, separately from index-update time.

The timeline command retrieves an exact conversation branch in oldest/newest order with role/date filtering. Correction-language markers are unverified text signals, never an assertion of user acceptance. mergeHistoryContexts deduplicates overlapping returned messages within one generation and reports omitted spans; it performs no reads and cannot establish full conversation completeness.

## Owner audit and privacy

Every host must supply a durable audit sink. `createHistoryAuditLedger` provides a SQLite FULL-synchronous append ledger in a separately verified private root outside repositories. The sink acknowledges only after COMMIT. Audit failure blocks evidence release; a mutation committed before a sink failure may already have taken effect, so inspect state rather than blindly retrying. Prepared allowed events carry `releaseState: awaiting_final_checks`; subsequent policy, tombstone or generation failures produce denied events. This records preparation, not a proof that the caller received data. Local hash chains are not independently anchored tamper proof.

`createHistoryOwnerConsole` is a host-only human controller, not an agent tool, HTTP server or account configuration. Its trusted human callback and the service's independent `resolveOwnerAccess` must both authenticate the session. Owner policy must match the authenticated principal, tenant, owner and epoch with `channel: human` and `allowed: true`. Caller identity fields are insufficient. Audit inspection is partition-scoped and rechecked after its asynchronous read. Queries are private log data and untrusted text, never instructions. Deployment must separately protect the human channel and audit root from agent processes; same-user JavaScript interfaces do not establish OS isolation.

Owner inventory pages opaque records and privacy state without opening raw evidence. Owner privacy updates atomically replace a record-wide exclusion flag, up to 32 exact case-sensitive literal redactions (1..256 UTF-16 units each), and a bounded credential-redacted annotation. Longest overlapping literal matches win. Annotations are owner context with no instruction authority and are absent from ordinary agent results. Privacy changes advance the generation; identical replacements do not.

Exclusions remove FTS candidates and visible coverage, context, original and semantic access while retaining raw storage. Redactions rebuild searchable derivatives, apply before context/semantic snippets, mask titles/provenance labels and suppress metadata/attachment details. Controlled original and shared-member raw reads are blocked rather than providing a bypass. Future imports retain the rules. Removing a rule intentionally restores access from retained source. Tombstoning still removes vault rows and prevents reimport; external archives/backups are not erased.

Optional semantic candidates can specify an exact bounded span within the authorized redacted projection. Span coordinates and text are validated against source, not provider payloads. Multiple provider spans of the same evidence unit collapse to the first ranked unit. The optional in-memory index builder below provides synthetic chunk-index integration. Actual model provisioning and archive evaluation remain separately unverified. Synthetic checks cover privacy across reimport, lexical/context/provenance/semantic surfaces, audit failure, human-only controls, revocation and byte-preserving v4 refusal.

## In-memory semantic index and human page adapters

`createLocalHistorySemanticIndex` takes a versioned host-vetted local encoder and explicitly supplied authorized projections. Refresh is bounded to 1000 documents, 5000 spans, 16 MiB text, 32768 UTF-16 units per document, and 30 seconds. Chunk sizes are 80..4000 units with smaller overlap; boundaries preserve surrogate pairs. Content hashes reuse unchanged vectors under the same model identity, while an atomic replacement drops omitted documents. Revocation, invalid vectors or cancellation leave the last complete state unchanged. An adapter captures one complete generation and exposes its content-manifest hash; older adapters fail the service's current-generation check. Storage is memory-only, with exact bounded cosine ranking, not a production full-archive ANN claim.

The builder performs no archive reads, filesystem persistence, model downloads or network operations. A manifest identifies supplied projections and model metadata, not full archive coverage, model weight attestation or measured relevance. Synthetic tests exercise refresh/reuse/change/drop, cancellation, revocation, Unicode spans and service rehydration after owner redaction. Actual production provisioning remains separate.

`console.page` authenticates human scope, reads bounded inventory and partition-scoped audit, rechecks scope and generation, and renders escaped HTML without active scripts or external resources. Privacy forms remain disabled unless the host explicitly supplies a same-origin POST path and a session-bound mutation token. The controller requires a trusted `verifyHumanMutation({requestContext,csrfToken})` acknowledgement before writing; absent, rejected or throwing verifiers deny the write. The host must implement the actual session/nonce mechanism. No such mechanism or server is installed here.

`parseHistoryOwnerPrivacyForm` admits only bounded privacy fields and translates checkbox/JSON form values; it cannot provide request context, principal, partition or policy. The authenticated host supplies those separately. HTML escapes annotations, queries and form values so archive/log text cannot become markup. The source page/controller/parser are implemented and tested; binding and deployment of the protected human endpoint remain unverified.

### Recovered file artifacts

Adapter v7 accepts explicitly prepared artifacts-NNNN.json shards. Artifact units have their own role and document/code/activity/tool_activity/metadata kind; they never imply conversation authorship. Sanitized citation bodies retain source SHA-256, locator, date basis, and chunk offsets. Unknown chronology stays unknown. Hidden trace markers and unsafe provenance fail closed. Preparation reports oversized, trace-bearing, and unsafe omissions. Tool activity exposes metadata only. Originals and earlier failed statuses remain unchanged; recovery overlays classify formats and complete bounded fact indexes. Preparation does not activate retrieval or relax host ACL checks. Old v5 stores are rejected without migration.

### Explicit local-source reads

createLocalSourceHistoryService({sources, audit?, limits?, maxSourceBytes?, maxUnits?}) reads explicitly selected canonical files with pinned SHA-256 hashes using ordinary OS permissions. It needs no service host, authenticated request context, private-vault location, special ACL verifier, or protected audit ledger. By default the index and SQL temporary data live in RAM. An explicitly selected indexPath persists the same archive schema and citation key using ordinary OS permissions. Optional audit callbacks may write ordinary local query metadata; logging failure does not block retrieval. No callback is required.

Local readers expose search/context/timeline/reference/original/member reads and disposal. They have no mutation API, background listener or ACL-changing operation. Source file checks, hash-before-parse validation, bounded parsing, corpus budgets, citation checks, and visible-content rules remain active. createHistoryAgentReader({service:local}) uses this mode directly, without host bindings.

This is a separate local-only path. The persistent service still requires its authenticated access resolver, protected private storage, and durable audit acknowledgement. Local readers are rejected by the network agent broker, owner console, and owner HTTP adapter. Ordinary inherited source and optional log permissions are preserved; this mode grants no additional OS access or network exposure.

### Selected local archive collection

Use `pairofcleats history local --collection <manifest.json> search --query <text>`. The selected manifest contains `sources:[{path,sha256}]`, optional `indexPath`, and optional `catalogs:[{path,sourceRoot}]`; relative paths resolve beside the manifest. Conversation exports and `artifacts-####.json` shards import into the same archive reader. Reopening the same persistent collection preserves citations; imports are additive, so removing a manifest source does not remove previously indexed records. Use a different index path for a different collection.

Artifact context includes adjacent chunks of the same source hash, locator and artifact kind, with per-chunk provenance. References expose only exact catalog file references, declared message attachments and declared widget backing-conversation IDs. Missing targets remain explicitly unresolved. Matching titles or content do not imply a conversation relationship.

For recovered artifacts, `original` resolves a hash-verified top-level source file or catalog member blob, with container/member lineage and selected location. Small originals also include base64 bytes. Prepared projection JSON is never returned as the original. Missing catalogs or unmaterialized members produce an explicit unavailable state. Selected catalogs use the `private-file-evidence.v1` format. Conversation originals retain the existing archive behavior.

Archive selection applies role/date/path/revision constraints and exact phrase/exclusion eligibility to indexed redacted text before relevance ordering and the 1000-unit window. Ranked continuation cursors bind the query, filters, budgets and committed generation, survive collection reloads, and reject stale generations. Agent page.next preserves the complete request and advances to another candidate window when required. Window exhaustion, exact-total availability and full selected-input coverage are distinct. Coverage aggregates are cached by committed generation with a bounded shared cache.

Native local discovery supports searchField=text|title|path|facets|metadata. Body text remains the default literal evidence surface; metadata snippets declare their separate discovery span surface. The native index stores titles, source locators/member names, evidence/artifact kinds and roles. Owner redactions suppress discovery metadata; excluded/deleted records remain invisible. groupBy=original groups recovered chunks by preserved source SHA256, retaining individual citation references and group counts. Context preset=adjacent|user-assistant|user|assistant filters visible messages on the same anchor branch; it does not cross into alternative branches.

New imports maintain history-discovery.v1. Existing collections require explicit --rebuild-discovery on the local collection CLI or rebuildDiscovery:true in the selected-source factory before metadata search. The rebuild changes only derived tables and generation, preserving every original, sourceRef, snapshotRef and reference-key namespace. No automatic metadata backfill replaces selected source content. Example: pairofcleats history local --collection <manifest.json> --rebuild-discovery search --request '{"query":"manual","searchField":"path","groupBy":"original"}'. Existing optional semantic/media paths remain conditional on supplied adapters and explicit use; this change downloads no model and converts no media.

## Local EG2 archive embeddings

The selected-source factory accepts explicit archive embeddings configuration.
Vectors live in the selected archive SQLite database, separately from code
indexes. Ordinary code-search defaults remain MiniLM. Archive execution is
CPU-only: onnx-community/embeddinggemma-2-ONNX at immutable revision
daa72c51243991dfcaf9f9137d2c573d8f7790c0, Transformers.js 4.3.1, fp32 and full
768-dimensional document vectors. q8/q4 graph profiles are validated alternatives;
validation is not evidence of faster CPU kernels or acceptable retrieval quality.
Ordinary fp16 is not a generic acceleration option for EG2.

Example collection configuration:

    {
      "sources": [{"path": "artifacts-0001.json", "sha256": "<verified SHA256>"}],
      "indexPath": "archive.sqlite",
      "embeddings": {
        "modelsDir": "models",
        "dtype": "fp32",
        "dimensions": 768,
        "task": "search",
        "batchSize": 4,
        "chunkChars": 1000,
        "overlapChars": 200,
        "lookahead": 32,
        "maxPaddedTokens": 32768,
        "maxAttentionTokens": 67108864,
        "maxCacheInputs": 1000000,
        "maxCacheBytes": 8589934592,
        "sessionOptions": {"intraOpNumThreads": 6, "executionMode": "sequential"}
      }
    }

The example's thread count is explicit configuration, not a measured optimum.
Unset thread counts and executionMode remain unset at the public session boundary;
execution information does not invent effective native pool sizes. Relative
manifest sources, indexPath, catalogs, modelsDir and sessionOptions output paths
(profileFilePrefix, optimizedModelFilePath) resolve beside the selected manifest.
CLI --models-dir resolves against the working directory; path values inside CLI
--session-options JSON must be absolute, explicitly approved output paths.
Other identity strings and modelFileName are never resolved as filesystem paths.

The shared adapter performs real CPU inference with no synthetic fallback.
Provision the locked runtime through the project dependency workflow. modelsDir
selects the Transformers.js cache. Offline loading is the default.
allowDownloads:true or --allow-downloads permits model provisioning without
installing runtime dependencies.

### Independent computation identities and exact input reuse

The v2 document identity includes immutable model/tokenizer revision, full
768-dimensional profile, dtype/numerical recipe, optional verified graph SHA256
and graph basename, exact passage formatting, chunk geometry, tokenizer
truncation and normalization. Task/query prefix and requested dimensions have
separate query-policy and representation identities. Changing query task or
selecting 128/256/512 output dimensions retains document vectors: retrieval
truncates retained full vectors and normalizes the resulting prefix.

Changing document computation creates an independent generation instead of
erasing prior generations. Batch/session bounds and cache location do not change
document identity. An alternate transformed graph must declare graphSha256,
modelFileName and numericalRecipe; tokenizerIdentity must accurately identify its
tokenizer. Declaring a hash does not itself qualify a graph's operator behavior
or retrieval quality. Alternative precision/runtime trials use a separate
selected database. The current running CPU job and its identity remain unchanged.

Task search uses the upstream retrieval query prefix; code and
question-answering select their corresponding query prefixes. Every passage is
exactly "title: none | text: " plus redacted projected body text. The cache key
covers the complete effective passage input and document identity. It reuses
computation while preserving each unit/span occurrence and all original citation
provenance. Source text/metadata changes invalidate occurrence references in every
generation. Exclusion/deletion removes references and garbage-collects cached
input text/vector when its last occurrence disappears. No media is decoded or
embedded. Prompt definitions follow the
[upstream EG2 model card](https://huggingface.co/google/embeddinggemma-2).

A database containing v1 embedding tables is rejected with a conversion-required
error. There is no automatic migration, deletion or checkpoint rewriting.
Conversion must explicitly operate on a verified copy, preserve source/citation
identity and qualify the full-vector recipe before use. Keep the active original
checkpoint unchanged.

### Bounded scheduling and native settlement

    pairofcleats history local --collection collection.json embedding-status
    pairofcleats history local --collection collection.json embedding-execution-info
    pairofcleats history local --collection collection.json embed --max-units 100 --max-ms 30000
    pairofcleats history local --collection collection.json search --query "desired evidence" --mode hybrid

embed requires persistent indexPath. Resume only through a newly requested runtime after verified worker exit. Scheduling tokenizes a bounded lookahead once, uses actual token lengths,
packs similar lengths with stable mapping and drains each window before admitting
another, so long tail inputs cannot starve. Prepared subsets reuse private token
IDs; padding is constructed for the selected batch without tokenizing twice.

Controls and defaults:

| Control | Default | Valid bounds / meaning |
|---|---:|---|
| --batch-size | 4 | 1..64 unique effective inputs |
| --lookahead | min(256, batchSize*8) | batchSize..256 prepared unique inputs |
| --max-padded-tokens | 32768 | 1..524288; batch size times longest token length |
| --max-attention-tokens | 67108864 | 1..4294967296; batch size times longest token length squared |
| --max-batch-chars | 16000 | chunkChars..256000 projected characters |
| --max-cache-inputs | 1000000 | 1..10000000 cached inputs across retained generations |
| --max-cache-bytes | 8589934592 | full-vector bytes..68719476736; vector blobs plus UTF8 effective input, excluding SQLite overhead |
| --max-units | 100 | 1..1000000 admitted units per refresh |
| --max-ms | 30000 | 100..600000 per refresh, not a corpus-wide terminal limit |

Each input also respects the 8192-token model cap. Oversized single inputs fail
rather than escaping padded/attention budgets. Duplicate fanout and reused
occurrence transactions are bounded. Cache capacity is checked before committing
a batch; prepared statements are reused and capacity accounting is initialized
once per refresh. Returned telemetry includes actual/padded tokens and preparation,
encoding and transaction times.

Each completed batch is durable, including partial units; retrieval publishes a
unit only after every expected span is durable. Status reports document/query/
representation identities, complete units, pending units, durable occurrences,
unique cached inputs and nativeWorkPending. Partial successful work does not
establish whole-corpus coverage.

Cancellation/deadline returns retained coverage and discards late output.
Timeout is not evidence that native inference stopped. A refresh refuses another
submission while its preparation/inference promise remains unsettled; the runtime
also bounds native admission. Generation changes prevent late commits. Do not
automatically resubmit timed-out work or treat a watchdog kill as native
cancellation. Opening a collection starts no background indexing.

### Task-owned process cancellation contract

The next cancellation implementation isolates CPU preparation/inference in a
task-owned worker process, retained across durable checkpoint batches. The host
owns admission, cancellation and exit verification; it must remain responsive
while native ONNX execution blocks the worker event loop.

Cancellation has two distinct reported outcomes:

- requestAccepted means the host recorded the request, closed further admission
  and invalidated late results. It is not proof of native termination.
- workerStopped requires the owned child's actual exit event. Unconfirmed
  termination returns false and leaves the runtime terminal, with no resubmission.

The default allows **1000 ms of cooperative grace**, then kills only the original
live ChildProcess native handle. Confirmation has a further **2000 ms bound**;
failed verification reports an error rather than waiting indefinitely or claiming
success. Receipts distinguish cooperative, parent-forced, self-watchdog and
unconfirmed exits, including spawn/request/force/exit timestamps when observed.

Ownership uses the original forked ChildProcess handle and a private nonce/PID
handshake, never process-name killing or stale PID/ancestor discovery. The CPU
entry creates no descendant processes: ONNX execution uses native threads within
that child, and process exit terminates them. This mechanism does not claim
cleanup of arbitrary subprocess trees introduced by an alternative worker.
Qualification PID/PPID/run UUID and Node startup timestamps are diagnostics;
they do not authorize terminating a parent or establish OS creation-time proof.

If IPC is lost, the child independently drains or self-exits after 1000 ms, using
exit code 23 to distinguish watchdog termination from cooperative disposal.
Its watchdog requires a responsive JS event loop. A live parent can terminate a
synchronously blocked child through its external process handle; simultaneous
parent death and synchronous child-JS blockage remains a limitation.

A completed batch transaction remains durable after cancellation or termination.
Discard unfinished native outputs and any result with stale invocation,
generation or content identity. Mark interrupted work explicitly; replay only
uncommitted spans on a separately requested resume. Source occurrences,
citations, completed span receipts and partial-unit exclusion remain unchanged.
Never mark a unit complete from an in-flight or abandoned batch.

Cancellation, deadline and process failure must not automatically restart the
worker or indexing. After verified exit, keep the final receipt and require a new
explicit resume request. On failed verification, leave the unsettled-work latch
closed and report the blocker. Dispose and host IPC loss use the same bounded stop path; unrelated processes remain untouched.

Acceptance gates are code/fixture checks until explicit real execution is
requested: prompt host cancellation while a child is blocked, grace timing,
cooperative exit, forced owned-process exit, invalid ownership/nonce rejection,
no orphan/no automatic restart, retained committed batches and interrupted
replay with stale-generation rejection. Existing real CPU pilot receipts remain
historical evidence and must not be overwritten by these fixtures.

### CPU session configuration and execution information

--session-options accepts an object encoded as at most 16384 UTF8 bytes. Supported
fields are intraOpNumThreads/interOpNumThreads (1..256), executionMode
(sequential|parallel), graphOptimizationLevel (disabled|basic|extended|all),
enableCpuMemArena, enableMemPattern, enableProfiling, logSeverityLevel (0..4),
profileFilePrefix and optimizedModelFilePath. extra accepts only
session.intra_op.allow_spinning and session.inter_op.allow_spinning, each "0" or
"1". Unsupported options, providers or device fields fail validation.
--graph-sha256, --model-file-name, --tokenizer-identity and --numerical-recipe
override corresponding manifest identity fields.

embedding-execution-info is synchronous configuration inspection. It creates no
native session, loads no model and opens no selected database. Before inference,
its loader/session counters remain unloaded; effective native thread counts are
reported only when actually known. Explicit profiling/optimized-graph outputs
require approved paths and a separately authorized real trial. Provider stays CPU.

### Retrieval behavior

With completed units, auto selects hybrid body-evidence retrieval; otherwise auto
remains lexical without calling the model. Explicit semantic/hybrid requires a
configured nonempty index. Semantic candidates are independently discovered with
an exact bounded-memory cosine scan over persisted full vectors, deriving the
requested representation; role/date/snapshot/branch/phrase/exclusion eligibility
applies before top-N. Existing rehydration, provenance and rank fusion remain
authoritative. Explicit metadata surfaces stay lexical in auto;
explicit semantic rejects those fields. Original grouping is available in hybrid/semantic with source diversity limits.

Unit checks use labeled synthetic adapters. Real-model acceptance requires the
actual pinned runtime and cached weights. Source checks establish no real
inference quality, performance or full archive coverage. The historical
acceptance below describes its original implementation and checkpoint, not a
qualification of new v2 scheduling, graph transformations or alternative runtimes.

### Real-model acceptance record (October 9, 2026)

Windows Node 26.8.1 and the exact locked Transformers.js 4.3.1 dependency ran the
pinned official fp32/768 text model against 11 authorized preserved DAT units.
The eight required config/tokenizer/text graph files were acquired without
credentials; published large-file SHA256 hashes were verified. The fp32 external
weight SHA256 is 9fd452bfc6916e5a92f080f8dada35598ca4512b21c65897d4c5974d5f9630a2.

Actual inference persisted 55 finite vectors with L2 norms between
0.9999999863242878 and 1.000000029164629. Both semantic and hybrid searches returned
three evidence items while the lexical channel had zero candidates. Reopening
retained all 11 indexed units; a repeat resume encoded zero additional spans.
Original DAT SHA256 remained unchanged. No encoder injection or synthetic fallback
was used for this acceptance. The selected 89,059-unit corpus uses a separate
bounded resumable job; its reported coverage must not be inferred from this
small completed check.

Current structural/lexical policy and acceptance gates: [archive pipeline integration](../guides/archive-pipeline-integration-20261009.md).
