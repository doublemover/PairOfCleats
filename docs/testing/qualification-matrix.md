# Platform and performance qualification

Audited: 2026-11-07. The [roadmap](../roadmap.md) owns remaining work and execution
order. This matrix defines useful acceptance and distinguishes current evidence
from the broader qualification still required.

The [Windows campaign](../archived/windows-issue-validation-2026-11-07.md) records
2,502 source-bound observations: **2,485 pass,16 fail and one Linux-only fixture is
excluded on Windows**. Seven failures reach the outer30-second limit. Four revision
transition cases and12 native-index cases remain locally unqualified. These are
focused observations across recorded source checkpoints, not a final-tree or
full-suite pass. Of2,195 selected IDs,2,192 have local observations; three explicit
external/optional cases are listed below. Full original issue requirements and
follow-ups govern closure; passing adjacent fixtures alone does not.

## What exists

| Area | Evidence and coverage owner | Remaining boundary |
| --- | --- | --- |
| Parallel OS CI | Separate Ubuntu/Windows/macOS workflows freeze exact source/runtime-bound selections. Four correctness shards per OS retain lane coverage; compiler, runtime, ANN, native, API, USR, LSP shutdown and crash logging retain independent serial owners. SDK setup and the actual provider API integration stay in tooling. Aggregation validates original outcomes and unions exact V8 ranges. CI2368 atab0b36380 completes both required Ubuntu and Windows checks successfully;51/56 jobs pass. All three CI2367 failed fixtures pass. | macOS queue publication and clangd preflight fail, along with12 original Windows native-search seed deadlines in the independent terminal job. The null-grace race has a failing-before/passing-after cross-process regression. Standalone SDK provisioning and compact native inputs require new hosted proof. The [repair receipt](../archived/ci2365-failure-repairs-2026-11-07.json) retains every checkpoint. Exact exclusions and owners are in the [CI policy](ci-capability-policy.md). |
| Supported setup | Node26.13.0, Windows x64, ABI147;37 required native probes and eight patched packages/30 files/81 hunks verify without warnings or errors. Twenty-one readiness/identity/recovery cases and ten actual runtime/npm controls preserve ordinary-versus-JSON decisions, full-version identity, unsupported-runtime refusal and concurrent receipt/journal replacement. | Node26.12.1→26.13.0 is same-ABI minor-version drift; patch-only identity has field-comparison coverage. Metadata fixtures do not qualify application readiness. Use the exact repository pin and locked bootstrap for stale setup. |
| Native crash attribution | [Windows ONNX parity](../archived/windows-onnx-runtime-parity-2026-10-30.md) retains CDB evidence for the addon/DLL API mismatch. ONNX Runtime1.30.0 matches Transformers4.3.2. No native crash is observed in the current campaign. | Runtime qualification stays bound to its original commands, dependencies and source; absence of a crash in an unrelated check is not a regression proof. |
| Fatal workers | #1646 closes after four actual thread/process and fake-owner fixtures: asynchronous exceptions/rejections, held exit, failed stop, late results, PID/thread identity, ordinary failures, bounded replacements and no replay/fallback. | Preserve actual closure and reservations; task-promise or vendor-inventory settlement alone is insufficient. |
| Native terminal workflows | CI2367 at5f7e14315 passes all47 actual Windows native workflows:22 indexing,18 search and seven TS7.1 vendor requests. CI2368 atab0b36380 passes22 indexing and six search cases, but12 actual search seed builds exceed the unchanged10s bound; the subsequent vendor step does not execute. All three native-inspection jobs pass. | Compact physical input roots retain original builds and mirror original terminal/PID/source evidence under test logs. Three affected real Windows cases pass locally, including pagination and two-repository scope; all18 still need hosted proof. Twelve earlier local native-index failures remain separately recorded. Native timeout/held-cleanup keyboard qualification remains under #1558. |
| File and destination authority | Portable artifact controls use real files/exports and explicit alias-classification faults. The original physical source/destination alias assertions are conserved in `tui/operator-artifact-physical-alias`. | Physical Windows proof passes all40 hosted authority cases atab0b36380, zero retries/skips. Portable injection neither claims physical alias coverage nor requires local link creation/elevation. |
| SQLite/FTS and cache authority | Focused retrieval, generation/pointer, cold/warm cache, positive source and strict-format controls pass. Cold memory/SQLite report fixtures no longer read an author workspace. | Rank correlation diagnostics are not rank-equivalence qualification. Optional sqlite-vec remains separate. |
| Native database lifetime | Shared runtime owner replaces production imports from tooling.120 focused affected cases pass, including real native publication/cleanup, original result/inspection failures and LMDB callback/close ordering. | Broader allocation pressure, category cleanup and every unadopted consumer retain their issue-specific acceptance owners. |
| Native flow construction | #1682 closes with bounded real construction, paused-sink backpressure, exact batch-size invariance and cancellation/failure ownership. Raw logical-work samples are retained. | Logical construction bounds do not establish constant process heap/RSS or latency. |
| Comment admission and content maps | #1657 qualifies ordinary prose versus legal notices, policy/custom matcher behavior and current cache replay. #1654 qualifies21 actual logical-content, exact-key, YAML/TOML, VFS/token and retained-map/projection cases. | These bounded producer/consumer checks do not claim renderer, framework, native-parser or complete language qualification. |
| Triage lineage | #1699 qualifies17 bounded lineage/cursor/publication cases and actual ingest/decision/context CLI, preserving all code/prose/comment source/identity comparisons. | Historical decisions remain historical facts; relation or similarity never grants mutation, approval or suppression authority. |
| Revision oracle | Closed published-index v3 retains canonical commands, normal workers, fixed two-world overlap, ordered candidate revisions and exact source/UID/token comparisons. Recheck and pending-reader retirement pass. Exact optional validation omissions are asserted. | All six real cases pass on hosted Windows atab0b36380 under the original25-second operation bound. Four earlier local C-drive transition failures remain historical local observations. Broader semantic/build-world/certificate/suggestion adapters and failing-world minimization remain open under #1528. |
| TypeScript and managed providers | Experimental TS7.1 component/contract/vendor25-case qualification includes seven actual Windows vendor requests and both child closes. Managed operational recovery and selected provider fixtures pass. | Existing compiler-consumer migration, stable promotion, complete package/build closures and remaining real provider consumers stay open under #1155/#1559 and related owners. |
| Questions, evidence and services | Selected real artifact/SQLite/compiler-reader and HTTP/MCP contract cases pass, including authority, missing-generation, invalid-request, cursor, incomplete and cancellation negatives. | Finite profiles and component parity do not establish every live/spilled semantic implementation, external reference process or real-model evaluation. |
| Architecture and documentation references | Architecture DTO/policy identity and existing detection/cap controls are present. RST/AsciiDoc outline controls pass. | #1707 still needs generation-qualified source occurrences and independent report-route proof. #1722 still needs typed reference resolution and persisted navigation. |
| VFS materialization | Changed/missing/truncated bytes, current-root selection, verified reuse, conflicting writes and original descriptor/lock recovery controls pass. | #1643 still needs request/session lifetime through outstanding provider use, cancellation and generation replacement. |
| Import coupling | Windows API CLI controls and the unchanged import budget pass; report imports drop620→558 modules. | Paired single startup observations show no meaningful latency change; this is a coupling result. |
| Windows contained admission | Ordered root/component probes use awaited native I/O for asynchronous admission; descriptor identity, post-read verification and original close remain binding. All29 selected file/hash/manifest/publication controls pass. A held-probe regression fails before the repair. | A64-file/four-reader diagnostic gives median336→211ms with identical bytes/hashes and16 raw samples. The16 longer local cases remain failures; this workload result does not qualify their full pipelines. |

Hosted Linux/macOS execution comes from GitHub Actions; no local WSL campaign is
used. [CI2354](https://github.com/doublemover/PairOfCleats/actions/runs/42402285922)
at22c624f72 passes gate, Rust, Windows authority, all three native-inspection jobs
and Windows native indexing. Windows general runtime checks pass189 and fail the
same four revision deadlines. Later-source hosted results must be read separately.
The receipt retains earlier macOS/Ubuntu failures and their exact source states.

## Useful required coverage

- Keep actual production owners for scheduling, replay, leases, publication,
  cancellation and cleanup. Retain positive results alongside invalid, stale,
  unknown, missing-generation, authority and cursor negatives.
- Reproduce a native failure in an owned fresh process, capture the actual
  exception/stack and prove its regression before declaring closure. Normal
  backend/worker settings must pass; diagnostic controls and retries do not qualify it.
- Native terminal acceptance uses the real binary/supervisor and asserts status,
  descendant closure, restored terminal and final job states. Protocol mocks cover
  their declared boundaries separately.
- Partition oversized wrappers only with explicit source/assertion/execution/lane
  mappings. Supported lexical seeds may prepare lexical consumers; that does not
  qualify unrelated semantic or native-backend stages. Keep cold and stale-cache
  admission independent of author caches.
- Run affected fixtures with one job, one indexing thread,30-second limits, zero
  retries and native-status redo disabled. Stop over-budget cases and retain the
  original result. After a repair, recheck affected cases rather than repeating
  successful broad campaigns.
- The cheap publication gate includes format, config/environment, generated
  freshness, command/workflow contracts, the46-case gate lane and diff checks.
  The gate lane alone is not the complete publication gate.

## Performance evidence to use

| Kind | Useful evidence | Current observation |
| --- | --- | --- |
| Correctness/resource bounds | Actual queue admission, retained bytes/rows, original cleanup, bounded work and independent output comparisons. | All144 cases in the selected serial cohorts have passing source-bound observations, including all four graph capsules. Many are work/resource contracts rather than latency measurements. |
| Coupling budgets | Fresh import census with unchanged thresholds and operational behavior. | API620→558 and build-entry2,409→2,197 imports; unchanged budgets pass. No latency speedup inferred. |
| Latency | Expected indexed sources before warm sampling; raw samples, exact workload/runtime and unchanged threshold. | SQLite `greet` and `answer` both retrieve `index.js`;20 warm samples give p95 **164.9ms**, below the unchanged **7,500ms** Windows bound. |
| Optimization qualification | Serial paired original/current/control arms, independent output identity, actual work, CPU/wall/peak observations and declared cold/warm scope. | Current artifact/health/row/encoding/risk samples are retained in the campaign; mixed timings do not establish a universal speedup or complete every performance issue. |

Run measured checks serially. Keep fixture duration, logical-work counters,
import counts, query latency, heap and RSS as distinct observations. Preserve raw
samples and failed/unknown arms; do not select only favorable trials or change
thresholds after observing a result. Real-model, large-corpus, optional-backend
and release campaigns need their own declared workloads and acceptance.

## Explicit external and optional scope

- `smoke/tantivy`: native qualification is deferred by user decision; #1627 stays
  experimental. Pure contract checks cannot close that native work.
- `storage/sqlite/ann/sqlite-extension`: optional sqlite-vec is outside this target.
- `tui/operator-artifact-physical-alias`: retained physical alias qualifier runs in
  the capable hosted Windows authority owner. Local validation creates no links
  and makes no security-setting or permission changes. The hosted40-case cohort
  passes this exact retained qualifier at98d68675c.
- The Linux ELF/clangd positive fixture remains platform-specific. Its Windows
  unsupported-platform and portable authority controls remain separate; a Windows
  executable is not a Linux sealing witness.
- Excluded VSCode/Sublime product work and the identified editor-only remainders
  remain open. Headless contract fixtures do not qualify an editor application.

Earlier dated campaigns and native/SQLite/provider receipts remain linked from
[the qualification archive](../archived/native-runtime-qualification-index-2026-10-27.md),
[the current campaign](../archived/windows-issue-validation-2026-11-07.md) and the
[roadmap](../roadmap.md). Their original source identities and limitations remain
in those receipts; they do not turn earlier green observations into later-head acceptance.
