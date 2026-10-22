# Retrieval Evaluation

`tools/eval/run.js` runs a query set against a repo and emits JSON metrics (Recall@k, MRR, nDCG@k).

## Usage

```bash
node tools/eval/run.js --repo /path/to/repo --dataset /path/to/queries.json --backend sqlite --top 10
```

Options:
- `--repo`: repo root (defaults to current working directory)
- `--dataset`: JSON file with queries (defaults to `tests/fixtures/sample/eval.json`)
- `--backend`: `auto|memory|sqlite|sqlite-fts|lmdb`
- `--top` (`-n`): top N results to evaluate (default: 10)
- `--ann` / `--no-ann`: include dense ANN in the run
- `--match-mode`: `substring` (default) or `exact`
- `--out`: write JSON report to a file
- `--pretty`: pretty-print JSON to stdout
- `--progress`: `auto|off|jsonl` (default `auto`)
- `--verbose` / `--quiet`: control stderr logging

## Dataset format

Each entry uses a query plus expected hits. `relevant` is the silver label set; `gold` is an optional stricter subset.

```json
[
  {
    "query": "greet",
    "mode": "code",
    "relevant": [{ "file": "src/index.js", "name": "greet" }],
    "gold": [{ "file": "src/index.js", "name": "greet" }]
  }
]
```

Compatibility:
- `expect` (used by fixture eval) is treated as `relevant` if present.

Sample dataset:
- `tools/eval/sample.json` includes a small silver+gold set using the sample fixture.

## Metrics

- Recall@k: relevant hits found in the top k results.
- MRR: mean reciprocal rank of the first relevant hit.
- nDCG@k: rank-aware gain normalized by the ideal ordering.

Judgment policy `distinct-document-one-to-one.v1` deduplicates identical expected
labels and assigns each distinct retrieved document to at most one relevant
slot. Overlapping file and symbol predicates use deterministic maximum matching;
one hit cannot increase recall or gain twice. Metrics validate unique positive
ranks and distinct relevant counts instead of clamping impossible results.

Model comparisons use repository/mode-scoped stable chunk or file/range identity.
Generation-local document ordinals qualify only with an explicit shared index
namespace. Cross-model reports require matching corpus provenance digests that
exclude embedding identity; missing provenance is reported as incomparable rather
than averaged into parity metrics.

## Independent vector oracles

An evaluation case may include `vectorEvaluation`, one version1 record or at most
four records following `src/contracts/schemas/vector-evaluation.js`. The report
adds `vectorOracleReplay` alongside the live query's judged metrics. This is saved
raw-stage replay, explicitly `currentSearchEvidence:false`; replayed ANN lists do
not qualify a newly issued live search. It uses the existing report output and
does not create another result store or change production ranking.

Each input binds an immutable source-corpus digest and generation SHA256,
repository/mode/file/span/offset-unit/content identity, exact model revision or
digest, graph/tokenizer digests, dimensions, metric, normalization and quantizer.
Query text/filter/vector and independent eligibility-policy identities are bound
separately. Original FP32 capture has its own provenance/digest and explicit
available/partial/unavailable status. Local ordinals never participate in source
joins. Reordering source rows leaves the admitted replay identity unchanged;
ordered sparse/vector/final candidate lists retain their ranking meaning.

`src/retrieval/evaluation/vector-oracle.js` exhaustively scores the known eligible
source universe independently of ANN candidates and production rankers. Eligibility
must be complete hand-admitted or independently derived source facts. It reports
observed eligibility disagreements before vector recall. Presence masks exclude
missing channels while retaining present zero vectors. Unsupported/missing
originals are never reconstructed from uint8 or labeled original FP32.

Original/query coordinates must be exact finite FP32 values. Stored coordinates
use the declared affine uint8 quantizer and round through FP32. Optional L2
normalization rounds quotients through FP32; independent scalar metric accumulation
uses JavaScript float64. Cosine assigns0 to a zero-norm pair, dot preserves negative
scores, and L2 exposes negative squared distance so every result orders higher
scores first. Ties use ascending source keys. A top-k denominator is the number
actually available when fewer than k eligible present channels exist; an empty
universe reports a null ratio with denominator0, not fabricated perfect recall.

Raw receipts separate original/stored top-k agreement, ANN candidate inclusion,
ANN top-k recall, sparse/vector union inclusion and judged relevance. They retain
input/model/query provenance and raw visited/eligible/absent/scored/candidate
counts. Partial original capture prevents original-reference metrics for an
uncovered eligible universe; stored-only results remain explicitly labeled.

Admission is capped at16MiB JSON,32,768 rows,4,096 dimensions and2Mi coordinates.
Scoring uses bounded top-k heaps, batch yields and tighter-only row/work/time/output
limits. Cancellation, limit exhaustion or incomplete eligibility returns
`complete:false` and no quality metrics. A small output allowance returns only a
terminal incomplete receipt. Replay resumes by validating the immutable record
key and restarting from zero; interrupted heaps are never published/cached as
complete or reused without their earlier work. Replay scoring time includes input
admission and is separate from full retrieval latency.

The new hand-enumerated geometry/provenance/eligibility/limits fixtures are
source-authored and unrun. No representative-corpus quality, ANN recall, latency
or memory acceptance has been established. Those campaigns remain separately
scoped; these adapters supply reproducible independent references for them.

## Saved fusion and candidate-depth sweeps

`captureFusionReplay` in `src/retrieval/evaluation/fusion-replay.js` accepts explicit
production fusion/rank inputs and an independently admitted vector evaluation
record. It freezes ordered raw sparse/dense scores, explicit score spaces and
channel membership, eligibility/phrase/export facts, relation/graph inputs and
stable source mappings. Missing source scores remain null. The selected embedding
generation and actual file/span mapping must match the vector record. Opaque
callbacks are reduced to bounded facts, not serialized or executed during replay.
Capture rejects a baseline that does not reproduce the actual production output
exactly. Time-dependent graph cutoffs are unsupported for deterministic capture.
The rank query must match the admitted query-text digest. Capture owns channel,
metadata, relation and baseline values before yielding for the independent oracle;
later mutations of borrowed input arrays cannot enter the saved generation.

The strict version1 record binds source/model/query/filter/oracle identities,
Node runtime and whole scoring-owner source hashes. A changed policy requires a
fresh capture. Replay uses production calibration, fusion, gates, boosts, tie
selection, diversity and graph owners. Its temporary scoring path preserves all
gated union members before selecting the final bounded window; inputs and shared
chunk metadata remain untouched. A candidate can ablate boosts or diversity,
vary sparse/dense depths independently, and select current behavior, RRF, existing
active-channel-renormalized blend or the explicit `fixed-missing` baseline.
The latter retains the observed union, normalizes sparse scores by the positive
list maximum and dense scores through production calibration, then divides the
weighted sum by the full configured weight total. Missing normalized
contributions count as zero only in this experimental formula; their raw source
scores stay null. Zero-weight-only members remain in the union.

`sweepFusionReplays` accepts an explicit grid of at most64 settings and256 unique
queries sharing one model/source generation/output cap. Seeded query-identity
hashes allocate60/20/20 train/dev/test buckets independently of input order.
Every saved current baseline must pass parity first. Development graded nDCG
selects a setting; a stable policy-key tie break and frozen selection receipt are
constructed before held-out judgments are scored. Test labels cannot select the
winner. Empty splits or missing development judgments produce incomplete receipts.
Reports retain candidate recall and its declared original/stored reference,
missing-channel counts, graded nDCG, positive-label recall, MRR and paired query
deltas. The95% interval is a descriptive normal approximation; single-query
samples have no interval, and no statistical promotion is implied.

Admission is bounded to8MiB per record and16MiB per sweep,4,096 union members,
1,000,000 candidate work units and a cooperative2s sweep deadline. Tighter-only
record/grid/input/output/work/time bounds are accepted. Cancellation or any
budget exhaustion yields `complete:false`, `selected:null`, and no metrics.
Output overflow returns a minimal incomplete receipt. Checkpoint keys bind all
record, schema, metric, source policy, grid and split identities; resume validates
that key and restarts from zero. The saved-score replay clock includes admission
and reports no retrieval, model, index IO or end-to-end search latency.

Existing evaluation dataset entries can add `fusionReplay` (one record or at most
four), `fusionReplayGrid` and an optional shared `fusionReplaySeed`. All selected
entries must agree on grid/seed and query text digest. `tools/eval/run.js` adds a
separate top-level `fusionReplay` report with `currentSearchEvidence:false`; its
metrics do not enter live search aggregates. No production default, public config
knob, result store or automatic live capture is added. Golden/sweep regressions
are authored but unrun. Representative held-out, per-class, matched-work quality
and platform/resource qualification remain open.

## Saved query-routing shadows

Cases may carry an explicit `shadowRouting` saved-input object. The evaluator adds
a separate feature-only class proposal and optional generation-qualified saved
repository-pool allocation report. The [shadow contract](../contracts/shadow-query-routing.md)
defines syntax precedence, abstention, fixed versus weighted quotas, exploration
floors, missing judgments and bounds. Labels do not select production providers,
and saved graded gain/coverage does not enter live quality aggregates or certify
recall/cost. Malformed shadow inputs report incomplete evidence without discarding
the primary evaluation. All new source/assertions remain unvalidated.
