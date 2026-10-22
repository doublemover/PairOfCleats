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
