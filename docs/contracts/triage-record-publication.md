# Coherent triage record publication

The canonical `<recordId>.json` selects one complete immutable record generation.
Its `_pairofcleatsRecordPublication` receipt is a strict version-one contract,
including record/generation identity, renderer version and content/Markdown
hashes and byte count. It supplies no paths or deletion authority. The producer
derives payload paths inside the explicitly selected records root:
`.record-artifacts/<record-key>/<generation>/{record.json,record.md}`.

The shared cross-process file-lock owner serializes writes to one record ID.
Independent IDs have independent locks; Windows aliases share the lock key and
cannot overwrite a different stored record identity. Fallback identity conflict
decisions run inside that ownership. Input is captured once before asynchronous
work. Exact reimports reuse an already verified generation. Canonical JSON is
bounded to 16 MiB and Markdown to 32 MiB, matching their consuming read allowances.

Both immutable payloads use the existing original descriptor/atomic-publication
owners. Their readback must match the captured generation before the canonical
JSON selector is atomically published. No derived write follows that commit.
An interrupted or failed stage cannot become an inventory input. Prior immutable
payloads remain readable, and the exact previous selector is retained in the new
stage as `previous-record.json`. Atomic publication/close/parent-sync failure
remains an error with its existing ownership observations and staging context;
it is not reclassified as successful publication. The existing lock owner retains
unsettled native or independent work until explicit original metadata recovery.
Recovery never repeats the failed record operation.

CLI results continue to supply `jsonPath` and `mdPath`. Consumers must use the
returned Markdown path; it now identifies the immutable selected generation.
The producer does not update a second mutable `<recordId>.md` alias and does not
claim two renames make a pair atomic. Existing legacy Markdown files remain
readable and are never rewritten or removed by migration. JSON-only finding and
history consumers retain the original public record fields; their descriptor
observation still hashes the complete selected canonical wire snapshot.

Records inventory recognizes committed canonical JSON even without a Markdown
alias, preserves legacy Markdown discovery and ignores unrelated JSON-only
legacy files. The reserved private namespace requires its exact producer marker;
unknown contents are preserved and block admission. Unpublished and historical
generation payloads are excluded from enumeration. The marker alone does not
authorize deleting, migrating or adopting another root.

Inventory follows only the strict selector's derived paths and verifies actual
JSON/Markdown bytes and the renderer result. It passes a constant-size witness
for the current yielded source into the existing source union. The indexer
rechecks both expected hashes/lengths when consuming the source and during warm
replay admission. It does not retain one full JSON record/Markdown string per
inventory entry or independently reload the latest mutable selector for metadata.
Existing source references point to the immutable physical Markdown generation,
so deferred embeddings can still read the original source after a later update.
New decision views use renderer 2, including the original finding link. Existing
renderer-1 generations retain exact verification through their original renderer.
Reimport upgrades rendering in a new generation and preserves earlier evidence.
The shared records producer version is 11; earlier derived meaning cannot replay.

No CLI flag, configuration knob, vector/SQLite artifact relaxation or automatic
retention/deletion policy is added. Distinct updates retain evidence; common
lifecycle/quota policy remains owned by #1267. These are per-record product/read
bounds, not a measured process-memory, throughput or whole-store quota claim.

The 16 `tooling/triage/record-publication/*` cases are **authored and unexecuted**.
They cover controlled same-ID and actual separate-process interleavings,
independent IDs, stage/publication failure, exact reimport, source capture,
receipt/type/hash negatives, unknown namespaces, actual builder generation/hash
admission with its artifact handoff captured, retained generation reads and
original pending-resource/metadata recovery. The child fixture explicitly uses
the current Node executable with hidden windows and bounded IPC/output/lifetime;
it opens no editor or terminal. Original CLI/index/source/replay fixtures and
current-candidate functional/native qualification remain pending.
