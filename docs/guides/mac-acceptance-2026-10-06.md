# macOS verification checklist

This is a runnable acceptance plan, not macOS evidence. Use an explicitly
authorized Mac checkout and record `git rev-parse HEAD`, `git status --short`,
`node --version`, `uname -a`, and `cargo --version` with every receipt. Do not mix
results from different revisions. The frozen `13136005` candidate has Linux
CI-lite 822/822 and gate 35/35; later follow-on changes need separate acceptance.
The [canonical roadmap](../roadmap.md) owns the remaining queue.

## First: platform failures and process cleanup

Run each test separately with a 30-second deadline and preserve stdout, stderr,
exit status, signal, timeout, and peak process-family memory. Use Node 24.21.0,
one worker, a 512 MiB Node heap, and an agreed aggregate-memory cap. Retain failures;
do not count a skipped assertion, empty result, or missing receipt as a pass.

```sh
node tests/tooling/doctor/command-profile-contract-matrix.test.js
node tests/shared/subprocess/sync-timeout-kills-child-tree.test.js
node tests/shared/subprocess/command-invocation.test.js
node tests/tooling/ingest/shared-runner-lifecycle.test.js
node tests/tooling/ingest/output-preservation.test.js
node tests/indexing/discovery/generated-records-precedence.test.js
node tests/tooling/reports/object-cache-isolation.test.js
```

The last three tests require the follow-on branch, beginning with `86956b96`,
`9d511c9f`, and `add92f62` respectively. The Pyright test now records bounded,
redacted probe diagnostics on failure; a Linux pass did not fix or diagnose the
earlier macOS cause. Verify no live descendant remains after timeout/cancellation,
and that previous ingest output and summary bytes survive failed input.
macOS results do not close the native Windows literal-argument requirement.

## Setup and native TUI

1. In an isolated fixture/home/cache, exercise fresh and repeated noninteractive
   setup, closed interactive stdin, missing dependencies, invalid flags, and an
   unwritable destination. Preserve readiness details and exit codes. Separately
   record whether a clean exact-lock dependency install was actually performed.
2. With an already approved, available Rust toolchain, run `node bin/pairofcleats.js
   tui build --smoke`, then install under an explicit temporary install root.
   Do this from a different working directory as well as the application root.
   Record staged/installed binary checksums and target triple. Controlled Cargo
   fixture tests are not native build acceptance.
3. Run the real TUI: launch, resize narrow/wide, open/close help and the action
   palette, switch focus, run repeated jobs, cancel a long job, and quit. Repeat
   launch after a cancelled job. Confirm the terminal is restored and owned
   children/ports are gone. Preserve screenshots/frame captures and event logs.
4. Exercise real API and both MCP transports with repeated requests, invalid
   requests and shutdown; distinguish supervisor-protocol success from visual
   TUI success. Run the full selected Node lanes only after focused issues close.

## Reproduce the bounded benchmark workload

The Linux attempt `r5-bench-language-clean` used one 54-byte JavaScript source,
one query, memory retrieval, disabled ANN, stub embeddings and no provisioning.
At follow-on commit `add92f62`, it reached **1,024.03 MiB aggregate Node-family RSS**
and was stopped at the 1 GiB cap after **8.362 seconds**, exit `-15` (SIGTERM).
No final `receipt.json` existed. All matching Node processes were gone afterward.
The earlier larger fixture also exceeded the cap (1,031.00 MiB).

The log completed prerequisites and six guardrail snapshots, then reached stage-2
index initialization. The harness sampled aggregate RSS, not per-process
allocation breakdowns. These observations do not establish whether the excess is
baseline runtime/index loading or benchmark-specific allocations. Also, `--build`
requests both index and SQLite construction in the benchmark child, even when
query retrieval selects memory. Keep this distinction in any comparison.

From the selected application checkout, create only temporary fixture files:

```sh
export POC_ACCEPTANCE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/poc-mac-acceptance.XXXXXX")"
node --input-type=module -e '
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.POC_ACCEPTANCE_ROOT;
const repo = path.join(base, "repos/javascript/evaluation__tiny");
await fs.mkdir(repo, {recursive:true});
await fs.mkdir(path.join(base, "dictionary"));
await fs.mkdir(path.join(base, "home"));
await fs.writeFile(path.join(repo, "source.js"), "export function cacheRefresh(value) { return value; }\n");
await fs.writeFile(path.join(base, "queries.txt"), "cacheRefresh\n");
await fs.writeFile(path.join(base, "dictionary/en.txt"), "cache\nclear\nentry\nrefresh\nrecord\nvalue\n");
await fs.writeFile(path.join(repo, ".pairofcleats.json"), JSON.stringify({
  quality:"fast", threads:1,
  runtime:{maxOldSpaceMb:512,uvThreadpoolSize:1,ioOversubscribe:false},
  tooling:{autoInstallOnDetect:false,autoEnableOnDetect:false,allowGlobalFallback:false,lsp:{enabled:false}},
  indexing:{concurrency:1,importConcurrency:1,ioConcurrencyCap:1,scm:{provider:"none"},
    workerPool:{enabled:false,maxWorkers:1},
    embeddings:{enabled:false,mode:"off",concurrency:1,hnsw:{enabled:false},lancedb:{enabled:false}},
    typeInference:false,typeInferenceCrossFile:false,riskAnalysis:false,riskAnalysisCrossFile:false}
}));
await fs.writeFile(path.join(base, "catalog.json"), JSON.stringify({javascript:{label:"JavaScript",
  queries:path.join(base,"queries.txt"),repos:{small:["evaluation/tiny"]}}}));
'
PAIROFCLEATS_DICT_DIR="$POC_ACCEPTANCE_ROOT/dictionary" \
HOME="$POC_ACCEPTANCE_ROOT/home" XDG_CACHE_HOME="$POC_ACCEPTANCE_ROOT/home/.cache" \
XDG_CONFIG_HOME="$POC_ACCEPTANCE_ROOT/home/.config" \
NODE_OPTIONS=--max-old-space-size=512 PAIROFCLEATS_THREADS=1 \
PAIROFCLEATS_WORKER_POOL=off PAIROFCLEATS_EMBEDDINGS=off \
UV_THREADPOOL_SIZE=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
node bin/pairofcleats.js bench language \
  --config "$POC_ACCEPTANCE_ROOT/catalog.json" \
  --root "$POC_ACCEPTANCE_ROOT/repos" \
  --results "$POC_ACCEPTANCE_ROOT/results" \
  --cache-root "$POC_ACCEPTANCE_ROOT/cache" \
  --resource-root "$POC_ACCEPTANCE_ROOT/resources" \
  --no-clone --no-provision --build --stub-embeddings --no-ann \
  --backend memory --threads 1 --heap-mb 512 --limit 1 --json \
  --out "$POC_ACCEPTANCE_ROOT/receipt.json"
```

The command itself does not enforce an aggregate-family cap. Run it through the
Mac session's process-family monitor with a 30-second deadline; do not silently
raise the cap. Capture aggregate and per-process RSS/PIDs if available, so the
loading-versus-benchmark question can be answered. Preserve `results/logs/`,
prerequisite/run-ledger data, stdout/stderr, and the final receipt if produced.
Success requires exit 0, a fresh parsed receipt describing the requested repo,
nonempty executed query results and no failed/unverified measured rows. A dry run,
prerequisite-only result, or missing final receipt does not establish completion.
This tiny stubbed fixture is command/lifecycle acceptance, not search-quality or
representative performance evidence. Do not retry a capped workload unchanged.
