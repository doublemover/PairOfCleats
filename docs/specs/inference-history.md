# Inference-history private evidence pilot

Status: implemented local synthetic vertical slice; private-data and deployment acceptance pending.
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
| IH-004: Search versioned private history | Redacted bounded text, partition-local FTS5 statistics, exact source references, selected/alternative paths, import/node reuse, metadata-only invalidation and original-read permission | Engineering selection UI, date/role controls, ordinary retrieval-backend integration, qualified vector/media retrieval |
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
- `audit`: optional trusted protected sink receiving only principal/partition,
  policy epoch, action and outcome

The methods are `importExport`, `search`, `readOriginal`, `correlate` and
`deleteConversation`. They all accept an opaque `requestContext` and a `partition`
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
remains unvalidated by the Linux synthetic receipt.

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

Conversation identity includes trusted source scope and source conversation ID.
Node revision identity includes the mapping key and canonical raw node payload,
not just text. Conversation snapshots own path membership; changing a selected
leaf or title does not require recreating unchanged node projections. Projection
identity includes the transform version and character budget. A changed transform
must change that version. Reimporting identical bytes under the same transform
does not add versions. A later incomplete export does not delete old evidence.
Conflicting snapshots for the same conversation in one import fail rather than
selecting an arbitrary last shard.

Graph validation preserves malformed evidence while reporting missing/dangling
references, inconsistent edges and cycles. Invalid selected ancestry is `unknown`;
no longest-path fallback is labeled selected. Unknown roles/content remain raw
evidence. No assistant claim becomes verified repository state merely by import.

Asset references stay `unresolved`. Original-read output provides their exact
pointers and the checksum-bearing archive inventory; the pilot does not infer
asset identity from a filename, opaque pointer or similar-looking image. Code
parts remain ordered evidence and participate in bounded text retrieval.

## Projection and retrieval

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
