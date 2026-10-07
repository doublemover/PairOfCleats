# Matched macOS Node 24 / 26 evaluation

Status: **planned, not executed**. This recipe does not authorize starting a
local task or accessing any Mac folder. Obtain approval for the task, checkout,
benchmark directories and any runtime installation before running it.

## Question and fixed versions

Compare **24.21.0** with **26.10.0** on the same Mac, CPU architecture, immutable
PairOfCleats commit, package lock, patch files, fixtures and workload constants.
Use npm **11.19.1** for both dependency installations. Do not compare native
arm64 Node with an x64/Rosetta process. Record macOS version, hardware, power
mode and runtime versions. Keep the machine plugged in, idle and thermally
stable; do not run arms simultaneously. Keep the initial acceptance bounded to
one configured CPU worker and a 512 MiB measured memory budget on the small
fixture. The 384 MiB V8 old-space setting below leaves headroom; it does not
guarantee a 512 MiB total-RSS ceiling. Stop and report any budget overrun rather
than increasing the cap for one runtime.

The [official release index](https://nodejs.org/dist/index.json) identifies V8
13.6 and native module ABI 137 for 24.21.0, versus V8 14.6 and ABI 147 for
26.10.0. Never share `node_modules` between them. Use clean separate checkouts
and rebuild the identical native package versions with each runtime. A missing
native capability or different fallback is a compatibility result, not a speed
improvement. In particular record Tree-sitter, better-sqlite3, RE2, LMDB and
other optional capability differences.

## Source-backed hypotheses, not predicted wins

1. Compact JSON serialization is worth measuring. V8's
   [JSON.stringify fast path, introduced in 13.8](https://v8.dev/blog/json-stringify)
   is newer than the V8 version in Node 24. PairOfCleats directly stringifies
   row objects in `src/index/build/artifacts/writers/chunk-meta/shared.js` and
   `src/index/build/artifacts/writers/file-relations.js`; indexing measures
   these paths. Plain objects without replacers, pretty-print spacing or custom
   `toJSON` are the relevant cases. The upstream benchmark's speedup must not be
   attributed to this project. The custom recursive writer in
   `src/shared/json-stream/encode.js` serializes keys/primitives itself, so it
   does not automatically receive the full plain-object fast path.
2. Artifact streaming is worth measuring. The official
   [Node 26.8.0 changelog](https://nodejs.org/en/blog/release/v26.8.0)
   includes faster Readable async iteration, implemented in
   [nodejs/node#64447](https://github.com/nodejs/node/pull/64447).
   `src/shared/artifact-io/json/read-jsonl-stream.js` opens file streams, and
   `src/shared/artifact-io/json/line-scan.js` consumes them with `for await`.
   The existing streaming/materialization benchmark exercises that route when
   its file exceeds the 128 KiB threshold in `json/read-plan.js`. The bounded
   10,000-row fixture is 410,087 bytes, above that threshold. Measure both arms
   with the same row count; do not confuse its two algorithm labels with the
   Node versions.
3. Native ABI and stream changes need compatibility checks before any timing
   conclusion. [Node 26.0.0](https://nodejs.org/en/blog/release/v26.0.0)
   changes the ABI, stream read behavior and removes legacy `_stream_*`
   modules, `writeHeader` and `--experimental-transform-types`. Direct project
   code inspection found no use of those removed entry points, but native and
   transitive dependency compatibility still requires execution.

Node 26's Temporal, Map upsert and iterator APIs require code adoption and are
not automatic improvements to existing paths. Its Undici changes concern
downloads such as `tools/tooling/install-shared.js`, which are excluded from
timing. Built-in `node:sqlite` changes are not evidence for this project's
`better-sqlite3` backend. No runtime, latency or memory improvement is asserted
until matched measurements exist.

## Prepare once, outside measured runs

Prepare two approved clean checkouts of the exact same commit. In each, select
the corresponding installed Node version using the existing runtime manager.
The commands below are for bash/zsh on macOS; they do not install a runtime.
`npx --package npm@11.19.1` obtains the same official npm package for both arms;
do this during approved preparation, never within measured commands.

```sh
set -eu
node --version
node -p 'JSON.stringify({arch:process.arch,platform:process.platform,versions:process.versions})'
git rev-parse HEAD
shasum -a 256 package-lock.json
npx --yes --package npm@11.19.1 npm --version
npx --yes --package npm@11.19.1 npm run bootstrap:ci
node tools/setup/rebuild-native.js --verify
```

Verify the two reported revisions, lock digests and installed package versions
match. The repository's `.npmrc` and patches remain in force. Save installation
logs, including optional-native skips. Do not upgrade dependencies to make just
one arm pass; either fix both identically and restart or report the blocker.
Resolve all tool/model/network preparation before timing.

Run the same correctness checks in each arm. The test runner enforces the
repository's 30-second per-test limit; report skips/timeouts and failures rather
than treating an incomplete lane as a pass.

```sh
set -eu
node tests/ci/workflow-contract.test.js
node tests/ci/dependency-security-contract.test.js
node tests/run.js --lane gate --timeout-ms 30000
```

Full `node tests/run.js --lane ci --timeout-ms 30000` is optional broader
release-compatibility acceptance, separate from this limited experiment. It
requires additional language tooling and is not a prerequisite to the bounded
comparison. Limited results never imply a full-CI or release pass.

## Matched benchmark commands

Start a clean shell without inherited `PAIROFCLEATS_*` overrides or trusted
configuration. Run from each arm's checkout. Set `ARM` to `node24` or `node26` and `ROUND` to
the run number. Confirm `node --version` before each arm. Create unique result
directories; preserve them outside any directory the benchmarks clean.

The following configuration uses one index thread, disables worker pools,
adaptive/learned scheduling and real/stub embedding generation, disables SCM
and external tool enrichment, and isolates caches/home per arm and round.
`PAIROFCLEATS_TESTING=1` is necessary for the test-config override to apply.
`PAIROFCLEATS_EMBEDDINGS=stub` is only a safety fallback; the explicit
`indexing.embeddings.enabled=false` is what disables embedding work.

```sh
set -eu
export ARM=node24 ROUND=1
export PAIROFCLEATS_TESTING=1
export PAIROFCLEATS_EMBEDDINGS=stub
export PAIROFCLEATS_THREADS=1
export PAIROFCLEATS_BUNDLE_THREADS=1
export PAIROFCLEATS_WORKER_POOL=off
export UV_THREADPOOL_SIZE=1
export NODE_OPTIONS=--max-old-space-size=384
export PAIROFCLEATS_CACHE_ROOT="$PWD/.runtime-compare/$ARM/round-$ROUND/cache"
export PAIROFCLEATS_HOME="$PWD/.runtime-compare/$ARM/round-$ROUND/home"
export PAIROFCLEATS_TEST_CONFIG='{"indexing":{"embeddings":{"enabled":false,"mode":"off"},"concurrency":1,"workerPool":{"enabled":false},"autoProfile":{"enabled":false},"scheduler":{"enabled":false,"autoTune":{"enabled":false}},"scm":{"provider":"none","annotate":{"enabled":false}},"typeInference":false,"typeInferenceCrossFile":false},"tooling":{"autoEnableOnDetect":false,"autoInstallOnDetect":false}}'
OUT="$PWD/.runtime-compare/$ARM/round-$ROUND/results"
mkdir -p "$OUT" "$PAIROFCLEATS_HOME"
node -p 'JSON.stringify({arch:process.arch,platform:process.platform,versions:process.versions})' > "$OUT/runtime.json"

node tools/bench/micro/run.js --repo tests/fixtures/sample --mode code --backend memory --components index-build,sparse --threads 1 --runs 5 --warmup 1 --no-build --clean --no-stub-embeddings --json --out "$OUT/index-memory.json"
node tools/bench/micro/run.js --repo tests/fixtures/sample --mode code --backend sqlite --sqlite --components index-build,sparse --threads 1 --runs 5 --warmup 1 --no-build --clean --no-stub-embeddings --json --out "$OUT/index-sqlite.json"
node tools/bench/artifact-io/streaming-vs-materialize.js --rows 10000 > "$OUT/artifact-streaming.txt"
node tools/bench/index/tree-sitter-load.js --languages javascript,go,rust --files-per-language 10 --repeats 1 --json --out "$OUT/tree-sitter.json"
```

The index benchmark's `--no-build` disables its extra setup build, not the
explicit `index-build` component. That component performs one nonincremental
clean build, then five incremental no-change builds. Its `--warmup` applies to
search, not to those index builds. Sparse search then reads the index just
created by that same command. A build failure aborts before search, and each
arm/round has its own cache. Report these as separate workloads.
"Cold" here means application-cache cold, not an OS disk-cache flush.

Use an untimed trial round for both arms, then at least five fresh measured
rounds each, alternating order (24/26, 26/24, 24/26, 26/24, 24/26). Keep the
commands/configuration above identical. Check artifact counts, search results,
parser coverage and native backend selection before interpreting timings.
For RSS and CPU evidence, additionally wrap the same commands with macOS
`/usr/bin/time -l`, capturing stderr separately; apply that wrapper to both
arms. Label its reported process peak RSS; it is not a sum of the process-tree
footprint. Small fixtures establish controlled microbench behavior, not large-repo
throughput. Any later representative-corpus run needs a fixed corpus commit,
query set and matched configuration.

Report per-arm medians and spread across rounds, cold-build wall time,
incremental no-change time, warm search p50/p95 (with the small sample count
explicitly reported, not a tail-latency guarantee), artifact rows/second, parser
timings and peak RSS. Preserve raw outputs and exit statuses. A failed or
capability-mismatched arm stops the corresponding comparison. No source edits,
dependency changes, cache sharing, learned tuning, concurrent runs or model
downloads may be introduced between arms. Promote Node 26 only after separate
compatibility and release-policy review; a microbench win alone is insufficient.
