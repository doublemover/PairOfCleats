# Parallel implementation wave — 2026-10-23

The user restarted implementation with sixteen Sol 6.1 workers at xhigh effort.
This supersedes the parked-worker phase; broad final acceptance waits for a frozen
candidate. The lead continues the real Windows SQLite/CLI failures from the
previous validation wave. Existing green observations remain bound to their source.

## Shared instructions for this wave

- Work in `C:/Users/sneak/Development/PairOfCleats` on
  `codex/pr557-audit-repairs-20261012`, Node 26.12.1, Windows only. Read AGENTS.md.
  No worktrees, WSL, elevated permissions, security changes or physical links.
- Implement directly in real tracked product/test files. Ignored directories may
  contain execution receipts or issue inventories, never implementation drafts.
- Latest issue bodies are in the author-workspace metadata file
  `.tmp/tasks/windows-post-wave-20261022/open-issues-next-wave.json` (967 open,
  through #1550 at dispatch). The durable issue status is
  `github-issue-repairs-2026-10-21.md` in this directory. Read full assigned issue
  bodies and actual existing consumers; status prose alone does not prove closure.
- Prioritize P0–P4 defects in your owner, then performance, then remaining features.
  Finish a substantial contiguous implementation span; continue with related
  issues in your assigned owner without waiting for another agent or asking peers.
  No agent-to-agent coordination. Escalate only an actual ownership conflict to lead.
- Source authored does not equal qualified. Preserve strict authority/error/schema
  contracts and meaningful assertions. Fix causes; never disguise failures with
  skips, retries, larger deadlines, disabled production backends or reduced budgets.
  Do not manufacture unsupported provider/runtime capability or public completion
  from an unused helper. Author actual-consumer regressions while implementing.
- Frontload implementation. Do not run broad tests, bootstrap, benchmarks, native
  rebuilds or whole-repository lint/format. The lead owns deferred integration
  validation. The initial span allowed tiny decision checks; the lead later tightened this
  wave to no further runtime/feature checks while peers edit. Author regressions
  and defer execution until a stable candidate. Preserve earlier receipts as dated
  observations, never combine sources into current-head acceptance.
- Before your granular commits, run the real `npm run format` scoped ONLY to your
  owned changed JS files. Working scoped syntax has been demonstrated:
  `npm run format -- --ignore-pattern '**/*' --ignore-pattern '!src/'
  --ignore-pattern '!src/shared/' --ignore-pattern '!src/shared/owned-file.js'`.
  Generate a negated pattern for each ancestor directory of each selected file,
  then each exact file. Unrelated directories remain ignored. Use PowerShell arg
  arrays to avoid quoting mistakes. Inspect only your diff; never stage other work.
- Serialize only the brief Git stage/commit transaction using the named Windows
  mutex `Local\PairOfCleatsCodexSharedCommit`. Acquire with a bounded WaitOne,
  require an empty shared index, `git add -- <exact task-owned paths>`, inspect the
  staged names, and commit descriptively. Release/dispose the mutex in finally.
  Never use git add ., reset, stash, checkout or cleanup on peers' files. If the
  index is nonempty, leave it intact and defer that transaction. No global Git
  configuration changes or hook bypass. The lead pushes shared history and updates
  PR572; do not push, close issues, comment on GitHub or edit PRs independently.
- Do not edit central package/lock/pins/patches, analysis-versions.js, ESLint,
  roadmap, generated inventories, issue ledger or shared ordered manifests. Report
  required semantic version bumps and manifest membership changes to lead. Add
  owned ordinary documentation or a precise follow-up note in your final report.
- Report commits, exact files, addressed issue scope, remaining gaps, version-bump
  requests, authored coverage and checks actually run. Continue your owner until
  its substantial assigned span is implemented, then report and park.

## Exclusive owners

| Worker | Source ownership | Initial issue focus |
| --- | --- | --- |
| storage_setup | shared storage/contained-file/hash/lock owners, excluding JSON-stream and SQLite filter facts; related raw artifact readers | remaining P1/P2 original FD, resource and publication lifetime gaps; #1266/#1268 residuals |
| semantic_indexing | src/index semantic analysis, compiler binding, type/call inference and language extraction; excludes src/semantic serving stores and src/index/tooling | compiler inventory/replay/parity residuals; #818/#1132/#1133/#1484 |
| retrieval_editors_maps | src/map and tools/map browser/viewer, map-only API route, artifacts/preview/rendering and map-only tests; no editor extensions | #1545, then #864/#1273/#1295/#1297/#1299/#1300/#1301/#1302/#1317/#1324/#1367 |
| embedding_providers | provider/model encoding in shared ONNX/Xenova/EmbeddingGemma modules and provider adapters; excludes quantization and embedding execution plan | #1541/#1542/#1544, then related P2 model-space/shape/lifetime gaps |
| embedding_quantization | inline/worker quantization, dense-vector encoding/cache/artifact codec propagation | #1546/#1550, then #1387/#1388 residuals |
| federated_retrieval | src/retrieval/federation and federation-specific transport contracts/tests | #1549, then remaining ranked/enumeration/cursor/cache P2 defects |
| vscode_workflows | extensions/vscode, tools/tooling/navigation and navigation-qualified producer helpers, VSCode-only fixtures | #1543, then #1293/#1304/#1305/#1306/#1308 actual VSCode consumers |
| sublime_workflows | sublime integration and Sublime-only fixtures | #1293/#1304/#1305/#1306/#1308 actual Sublime consumers |
| jsonl_artifacts | src/shared/json-stream, sparse/postings physical shard/output representation and associated tests | #1548, then #1364/#1366 and prepared-row output residuals |
| semantic_serving | src/semantic serving store/manifest/query implementations and src/integrations/tooling semantic-detail/find/explain consumers | #1547 first, then P2 serving integrity/generation/cancellation/lifetime gaps |
| build_recovery | index build state/stage sealing/recovery and integration orchestration, excludes analysis and shared storage primitives | #1319/#1321/#1322/#1327, remaining P2 recovery correctness |
| scheduler_runtime | scheduler/admission/tokenizer resource pressure and bounded worker task contracts; excludes dense quantization and shared storage | #1342 first, then #1330/#1329/#1141 |
| tooling_provisioning | tools/tooling installation/detection/managed provisioning recipes, excludes navigation, tools/setup and language provider implementations | #631/#1313, remaining P2 preflight/quarantine/install-recovery defects |
| workspace_onboarding | tools/workspace, workspace catalog/build workflows, tools/setup/first-search-plan and their immediate owned helpers; excludes tools/setup/setup.js and identity primitives | #1275/#1283; actual supported first-search/federation onboarding |
| language_providers | src/index/tooling provider adapters/profiles/operational language-server integration; excludes analysis/compiler extraction and tools/tooling installers | pending #1151/#1152/#1154/#1155/#1159/#1160/#1161/#1162/#1163/#1165/#1166/#1168/#1169/#1170/#1171/#1172/#1174/#1175/#1176/#1179/#1181/#1184/#1186/#1192/#1193, prioritize explicit P2 defects |
| native_services | src/tui, crates/pairofcleats-tui, tools/tui and tools/service queue/supervisor lifecycle; excludes embedding codec/provider helpers and workspace build | #784/#1286, remaining P2 native-terminal/supervisor/queue cleanup and truthful progress |

The lead exclusively owns root CLI dispatch, current CLI test partitioning,
`tools/setup/setup.js`, embedding execution-plan source provenance, SQLite filter
facts, central versions/configuration/generated docs, mixed artifact-writer/worker-pool
integration, publication and validation.
The current working tree contains these intentional uncommitted repairs; preserve
them. The previous focused rerun has 11 passes and 3 wrapper timeouts; it is not a
clean-suite claim. Four new JSONL/federation/semantic/quantization reports were
inventoried during dispatch and remain unqualified until their owners finish.
