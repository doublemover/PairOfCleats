# Older phases audit (Phase 9 / Phase 7 / Phase 6 / Phase R)

This note lists **additional** issues found when re-checking older phases (relative to the task text in `COMPLETED_PHASES.md`).

---

## Phase 9 — Symbol identity + cross-file linking

### Tasks evaluated
- **9.C1 Identity primitives are used everywhere**
  - `chunkUid`, `segmentUid`, `virtualPath` present in `metaV2` and used as join keys.
- **9.C2 Symbol identity contract is emitted**
  - `symbolId`, `symbolKey`, `signatureKey`, `scopedId` are present and deterministic.
- **9.C3 Symbol graph artifacts are emitted**
  - `symbols.jsonl`, `symbol_occurrences.jsonl`, `symbol_edges.jsonl` writers + manifest entries.
- **9.C4 graph_relations v2 migration**
  - Graph node `id` uses `chunkUid` (not `file::name`), legacy ids retained only as attrs.
  - Edges emitted only for resolved symbol links.
- **Strict-mode join safety**
  - No `file::name` fallback joins in strict mode.

### Issues found
- ✅ **No additional issues found** in the above Phase 9 deliverables.

---

## Phase 7 — Embeddings + ANN unification

### Tasks evaluated
- **Exit criteria: embedding jobs are build-scoped + versioned**
  - `embeddingPayloadFormatVersion` exists and is set to `2` by the enqueue site.
  - `buildRoot` + `indexDir` fields exist and `indexDir` is validated as inside `buildRoot`.
- **Exit criteria: strict manifest-first discovery**
  - `src/shared/artifact-io/*` loaders enforce manifest-required reads in `strict: true`.
  - Retrieval uses manifest-based loaders; legacy fallback paths are only used in non-strict mode.
- **Exit criteria: quantization invariants**
  - Quantization clamps levels to `[2,256]`; uint8 quantization clamps to `<=255`.
- **Manifest completeness for ANN backends**
  - `tools/build-embeddings/manifest.js` includes bin + dir artifacts (HNSW + LanceDB) via an allowlist.

### Issues found
- ✅ **No additional issues found** in the above Phase 7 deliverables.

---

## Phase 6 — Tooling hardening + CI lanes

### Tasks evaluated
- **6.1.1 VFS virtual path contract + helpers**
- **6.2.1 / 6.2.2 PR CI runs ci-lite on Ubuntu/Windows/macOS**
- **6.5.1 ci-long lane support**

### Issues found
- **Phase 6 spec drift in `COMPLETED_PHASES.md` vs implemented VFS spec**
  - Phase 6 task text requires **base64url** encoding for container paths and defines `VFS_PREFIX = '.poc-vfs'`.
  - Implementation + `docs/specs/vfs-manifest-artifact.md` use a **percent-escape scheme** (escape `%` and `#`) and `VFS_PREFIX = '.poc-vfs/'`.
  - Result: **Phase 6.1.1 is not implemented “as written” in `COMPLETED_PHASES.md`**, even though the repo has a coherent alternative spec + implementation.

- **Phase 6 CI script interface mismatch**
  - Phase 6 task text repeatedly requires `npm run test:ci-lite` and `npm run test:ci-long`.
  - `package.json` **does not define** `test:ci-lite` or `test:ci-long` scripts.
  - GitHub Actions CI runs `node tools/ci/run-suite.js --mode pr` (which internally runs `node tests/run.js --lane ci-lite`), so the behavior exists, but the roadmap’s **explicit npm script entrypoints are missing**.

- **ci-long lane exists but is not wired to a stable command in CI**
  - The runner supports `--lane ci-long` and auto-adds tag `long`, but there is **no `npm run test:ci-long` alias** and nightly does **not** run a dedicated ci-long pass.

- **Windows PR CI is marked non-blocking**
  - `.github/workflows/ci.yml` sets `continue-on-error: true` for the `windows` job.
  - This may be intentional, but it diverges from the “runs the same command and is blocking unless too slow” expectation in the Phase 6 acceptance text.

---

## Phase R — Refactor hardening + drift-proofing

### Tasks evaluated
- **R.1.2 commands.md reproducibility (generator vs doc)**
- **R.1.3 “stable entrypoints” contract**
- **R.2.1 AGENTS.md coverage**

### Issues found
- **Stable entrypoints contract (R.1.3) not implemented as written**
  - Phase R requires stable npm scripts: `test`, `test:pr`, `test:nightly`, `verify`.
  - `package.json` does **not** define those scripts.
  - `docs/guides/commands.md` instead treats `node tests/run.js` and `node tools/ci/run-suite.js` as stable entrypoints.
  - Result: Phase R.1.3 is **implemented under a different contract** than the one written in `COMPLETED_PHASES.md`.

- **AGENTS.md test commands do not match repo scripts**
  - `AGENTS.md` tells contributors to run `npm test`, `npm run test:pr`, `npm run test:nightly`.
  - Those scripts **do not exist** in `package.json`; the actual stable test entrypoint is `node tests/run.js` (and CI is `node tools/ci/run-suite.js`).

