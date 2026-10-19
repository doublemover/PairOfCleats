# Windows deep-suite repairs, October 18

Status: in progress; this is a repair receipt, not final acceptance.

Branch: `codex/pr557-audit-repairs-20261012`, base HEAD
`ab00d918d77fd45c086831e9759d7596ac18a16d`, with the preceding uncommitted audit
repairs preserved. The [original audit](deep-test-audit-2026-10-18.md) retains
its 65-failure catalog and original logs. These new focused runs do not replace
those receipts or constitute an immutable whole-suite pass.

## Preserved installation and crash investigation

Historical author-workspace receipts are under
`temp/tasks/windows-deep-repairs-20261018/`; clean checkouts do not contain them.
`native-baseline.json` records the starting dependency versions, required patch
hashes, readiness receipt hash, 241 native binary/DLL hashes, Node executable
hash and runtime. `starting-worktree.patch` and `starting-untracked/` preserve
the initial repairs. The original native installation was preserved through dump
capture and attribution; the later locked bootstrap rebuilt the updated candidate.

The preserved crashing installation used Node 26.8.1, Windows x64, ABI 147. Its executable SHA-256
`5cba0ea928508c65ddadefc0681d2fb6d95f1f3beea4428f04397631140ee8e5`
matches the official Node 26.8.1 checksums. Matching `node_pdb.7z` symbols were
verified against SHA-256
`3629c52a09a189ed159f270addd068ee8dafebbcd1a1cca7fd053a114ea80504`.
Both the checksum list and symbols remain task-owned diagnostic inputs.

An isolated main-thread-only dump hook captured an unhandled access violation
from the original `indexing/semantic/compiler-bindings` fixture without changing
its exit status: `0xC0000005` after 17.3 seconds. The original
`indexing/semantic/embedded-source` fixture crashed in the same serial cohort.
The compiler dump SHA-256 is
`38f90d3463378ab0e1fe4093d6ebd20f6b50b26651a9a44f25e5840b8540a955`.
Matching private Node symbols locate the fault at
`node::Realm::set_should_purge_empty_cppgc_wrappers`, inlined through
`node::CppgcMixin::~CppgcMixin` and
`node::contextify::ContextifyScript::~ContextifyScript`. A cppgc sweep writes
through a freed Realm while a worker isolate tears down. The full exception
stack, context, modules and all-thread stacks are preserved in
`original-crash-cohort-analysis.log` beside the task-owned dump. The hook was
validated with a separate deliberate-crash self-test and never installed
machine-wide.

This stack is the exact failure described in upstream
[Node PR #65778](https://github.com/nodejs/node/pull/65778). Its
`CppgcTest.VmScriptCollectedBeforeFreeEnvironmentSweptAfter` fails under ASAN
before the fix, and the fix was released in
[Node 26.10.0](https://nodejs.org/en/blog/release/v26.10.0). The official
Windows x64 executable used for candidate diagnosis has SHA-256
`cea6ac365f9bb9586dafd2084d996e092e7d3e7d07ab52d1f76bf53d1fca9bc4`,
verified against the release checksums; ABI remains 147. The reduced pure
`vm.Script` child and one-build compiler route did not crash in ten and seven
pre-fix launches, respectively. They are useful controls, not a claimed local
fail-before reproduction. The two original raw fixture crashes and upstream
ASAN regression are the causal pre-fix evidence.

The candidate pin is Node 26.10.0. A final `npm run bootstrap:ci` exited zero
without warning or error lines, verified 37 required packages and activated 33
language routes. The Perl scanner patch now checks its allocation before use;
the patched native source compiles without the earlier MSVC C6011 warning. The
first migration bootstrap exposed an unsupported npm configuration warning and
the next detected a patch-input change during execution; both were corrected
before the clean final run. The candidate's task-local runtime must be selected
explicitly in this workspace because a fresh shell still resolves Node 26.8.1.

Ten separately recorded fresh normal runner processes alternated the original
compiler-binding and embedded-source routes, five each. All ten passed at one
job, one indexing thread, a 30-second fixture deadline, zero retries and native
status redo disabled. The original stub-embedding cache, code-map, observability
and context-pack crash routes also pass with those settings. The original summary
report route passed in 18.1 seconds after its slow aggregate fixture was split
into eight exact-sample mode/cache cases and a bounded all-mode integration case.
Those nine cases pass individually and retain positive SQLite row and publication
assertions. The old summary setup helper had no remaining caller; its lock helper
still serves stale-lock recovery. No crash-status retry or backend disablement was
used for these acceptance observations. The fresh-process receipts and original
report logs are task-local historical evidence, not clean-checkout artifacts.

Recorded controls include serial fresh worker termination, pool shutdown during
startup at several delays and heap limits, full-core imports in concurrent
workers, the original stub cache fixture, and late-attached real compiler/stub
builds. Passing controls do not attribute or close the original crash. Four
concurrent compiler fixtures exhausted their individual 30-second bounds; that
load experiment is failed diagnostic evidence, not acceptance. No backend
switch, crash-status redo or retry is accepted as closure.

## Repairs with focused evidence

- JavaScript AST chunking now retains exported values beside functions, including
  destructured and uninitialized declarations. The original `answer` query stays
  unchanged. A new contract case failed before repair. Incremental signature v7
  prevents reuse of bundles missing those declarations; chunk ID format is unchanged.
- All FTS variants defer query eligibility until bounded SQL candidates have
  metadata. Native term matching and exact literal phrase checks remain separate.
  Sparse fallback hydrates matching posting rows before applying exclusions.
  New cold/warm, Boolean, phrase, allowed-ID and fallback regressions failed
  before their respective repairs. Existing overfetch/pushdown budgets pass.
- A singleton FTS-rowid pushdown with row zero present returned row zero when
  restricted to row two in the installed SQLite 3.53.4. The joined ordinary
  `chunks.id` predicate preserves the restriction. The row-zero regression is
  retained; thresholds and result assertions are unchanged.
- The original prose explain-output fixture passes. SQLite latency passes with
  both original queries retrieving `index.js` before warm samples; the raw
  samples remain in the runner log. This focused observation precedes final
  candidate freezing and must not be reported as final-tree acceptance.
- Existing import budgets pass without increasing thresholds. Search-filter
  admission lives in its shared request owner; command metadata is independent
  of CLI parsing. MCP version lookup uses its narrow owner. Reader leases are
  separate from cleanup dependencies, while cleanup still uses the established
  lock implementation. Asynchronous writer/hash backends load when used.
  Reader exclusion, stale-owner recovery, hash and binary-writer checks pass.
- API risk metrics and as-of fixtures use canonical artifact identities. Runtime
  claims positives use a real published semantic source rather than an unverified
  target reference. Invalid-request, destination authority, missing generation
  and foreign-cursor negatives remain. All three focused API fixtures pass.
- Nested script-coverage groups explicitly pass zero retries to their child runner.
- LSP inventory refresh recognizes both occurrence and compiler invocation
  bindings and clears removed analysis observations. The existing embedded-cache
  failure passes with an added stale-resolution regression. LSP producer version
  advances from 8 to 9 so derived replay cannot reuse the old selection behavior.

## Windows terminal lifetime

The real native TUI and real supervisor run through the existing `node-pty`
capture owner. A PowerShell fixture observes actual console input/output modes
before and after the native child. Terminal failure closes its real output pipe
while retaining console input. Receipts require the native/proxy/supervisor/job/
detached-descendant family to be gone and final jobs to be terminal.

The first quit case completed its assertions but timed out because node-pty 1.1.0
left its ConPTY output connection worker and input socket alive on natural exit.
A bounded operation probe independently reproduced the leak before patching.
`patches/node-pty+1.1.0.patch` disposes those owners after output flush. Bootstrap
now verifies the PTY create/output/exit/dispose operation with natural process
exit, alongside parser activation. Locked bootstrap already includes the required
development dependency. Fresh native/patch verification exits zero without
warnings or errors and records 37 required packages and 33 language routes.

Unexpected supervisor exit also returned native status zero. The strengthened
test failed before repair; the Rust owner now propagates that failure after
shutdown and snapshot persistence. Windows quit, supervisor-error and terminal-
error fixtures pass at about four seconds each. They verify exit status, exact
console-mode restoration, descendant reaping and final job states. Expected
negative-case error diagnostics are asserted. The formerly timed-out terminal
capture fixture also passes. Linux execution remains separately unqualified.

The two actual C/clangd ELF-positive fixtures remain Linux-owned and unchanged
in their assertions. Windows acceptance must explicitly exclude them and retain
their Linux qualification gap. `native-toolchain-platform` proves Windows
unsupported-platform rejection plus portable structural authority; the existing
portable include-closure negative cases also pass. Windows executables do not
substitute for sealed Linux ELF evidence.

## Further focused repairs and Windows authority

An elevated task-local PowerShell launch created a real file symlink without
changing Windows security settings. Under that same token,
`security/editor-tui-authority` and `security/repository-authority` pass with
zero skips. `storage/semantic/runtime-opened-byte-integrity` also passes under
the capable token. Windows sharing rules prohibit replacing an open pathname;
that fixture now checks live fixed-length byte mutation plus real pre-open file
symlinks, while retaining the Unix live-symlink swap. It exposed a production
error-contract defect: an unsafe path rejected during `openContainedFile` escaped
before runtime-import error mapping. The open is now inside the owned cleanup
scope; the original fixture passes. Task-local elevated logs preserve raw results.

The safe uninstall fixture now resolves every dry-run deletion target, proves it
lies inside marked disposable roots, then executes the real uninstall. It passes
with the destructive tag explicitly selected; no user cache was deleted.
Tooling diagnostic retention now logs the first bounded, redacted live warning
cause even when its artifact path fails. The original diagnostic fixture and
runtime contract matrix pass. Gopls, doctor, managed-provider, quarantine and
five independently bounded abrupt-cleanup cases pass after explicit fixture
command/trust setup and abort-contract repair. Their negative trust assertions
remain. The install missing-requirement fixture no longer enters the real Go
SDK download fallback: it uses a disposable invalid SDK pointer and invalid
local command, retaining structured failure assertions. Both install exit-code
fixtures pass.

The ordered-completion tracker no longer retains its process keepalive after a
timed-out or aborted wait. Its original pending-work, child-lifetime and timeout
fixture passes in 3.7 seconds instead of timing out after its assertions. The
three-build document extraction cache wrapper is split into two 21-second
cases, preserving cache-key invalidation and stable-hit assertions. API trust
boundary startup rejections and positive local/non-local views run without an
unneeded full index and pass as two eight-to-nine-second fixtures; the remote
client uses loopback to address the wildcard listener while the listener scope
remains non-local.

Semantic trace now batches bounded incident rows while retaining exact cursor
offsets across filtered edges. Existing continuation/evidence and artifact/
SQLite parity fixtures pass. The SSR witness is split into cold parity,
incremental exact forward-content comparison, and incremental backend parity.
All three pass after the shared witness helper avoids duplicate source-manifest
reads: 18.3, 29.0 and 26.5 seconds, respectively. The 29-second case has little
timing margin and remains a performance concern for final acceptance. The
separate shard fixture validates each generation against its own pieces
manifest before comparing semantic content; it passes without suppressing
format identity. The earlier aggregate/rest parity mismatches were duplicate
evidence refs across continuation pages, now deduplicated by canonical ref
across the complete drained trace; strict record/edge comparisons remain.

The original `tooling/typescript-root-aliases` watchdog was an assertion
rendering a large compiler diagnostic, not a slow compiler run. A compact
diagnostic showed that Windows virtual imports could acquire a lowercased path
while the Program retained the root's original spelling. The provider and
compiler-dependency collector now preserve the VFS path returned to TypeScript;
the host canonicalizes origin lookups separately. The fixture checks exact
virtual-root identity, cross-document inference, triple-slash references and
cyclic/module-augmentation behavior. Its original timeout now passes in 0.6
seconds, alongside root preflight, virtual imports, resolution modes, source
reuse and a 24.3-second full compiler-bindings route. The compiler-bindings
semantic producer advances to version 9 and the TypeScript provider to 3.0.1
so old derived meaning is not replayed.

The original MCP robustness wrapper ran five complete server lifecycles in one
30-second boundary. It now has five individually discovered MCP cases with
separate disposable caches; all existing queue, cancellation, duplicate-ID,
progress and tool-timeout assertions pass in 6.6-7.5 seconds each. The MCP
search wrapper paired a runner-suffixed server cache with an unsuffixed shared
index cache; an explicit memory-backend query correctly returned `NO_INDEX`.
The sample/default/type case now builds and serves from the same isolated
cache and passes in 23.3 seconds. Its risk-tag filter case copies the two
original `runUnsafe` source files into a disposable repo, retains the original
query and positive/subset assertions, and passes in 16.9 seconds. This bounds
the real risk-bearing source pair without rebuilding every unrelated language
fixture. The original API semantic-detail and semantic-trace fixtures also
pass, at 26.4 and 29.3 seconds; the latter has little timing margin.

The seven-provider multifile LSP wrapper also exceeded one 30-second
boundary. It is now seven discovered cases with one provider/session each.
Each simulated positive selects the repository stub server through the Node
command and trusts its disposable workspace. PHP, Ruby and Dart cases include
their providers' required subcommand tokens after the script path so they
exercise the real provider argument handling without mislaunching Node.
All seven preserve the two-file hit and one-process reuse assertions; the
previously unverified PHP/Ruby cases now pass instead of silently skipping.

The SQLite partial-chunk fallback still checks that the bundle contains more
than one chunk after reducing its synthetic source from 256 to 64 functions;
it passes in 25.3 seconds. SQLite index-state fail-closed now uses preparatory
stage-2 builds without an unneeded automatic SQLite build, retaining its
explicit failure and recovery checks; it passes in 23.5 seconds. Runtime
source-reference authority has separate ordinary and foreign-generation
published-witness cases, passing in 25.1 and 29.1 seconds. API and federated
golden surfaces are separate discovered cases against the same golden values,
passing in 19.4 and 5.4 seconds.

The original fixture-parity wrapper built `sample` but omitted `--repo` when
calling equivalence, which created a second unrelated repo and exhausted the
watchdog. Passing the same fixture to equivalence and using stage-1 artifacts
for its `--no-ann` comparison preserves the original query and backend
assertions; a first pass took 25.5 seconds. After Markdown host prose added
work to this fixture, it was scoped to exclude unrelated SCM/type/risk/LSP
enrichment and passes on the resulting source in 24.6 seconds. Fixture
evaluation has three
independent corpus cases and uses the existing batch eval runner, avoiding one
search process per query. The old wrapper only printed missed expectations:
the repo-self showcase catalog had no source files and silently scored 0/10.
The test now copies the seven named production files into a disposable repo,
explicitly includes the named tool file (excluded by default), and fails on any missed
query. This exposed a production Markdown segmentation bug: any fenced code
block suppressed surrounding host prose. Host prose and embedded code are now
both segmented, with per-file signature version 8 invalidating old bundles.
The batch eval runner also now reads `extractedProse` for that explicit mode.
The final-tree focused eval cohort passes all original expectations: sample
11/11 in 25.0 seconds, mixed 7/7 in 22.5 seconds, and showcase 10/10 in 27.2
seconds. All eight segment fixtures pass on the same source, with no skips.

## Intermediate acceptance observations

An explicit follow-up selection of 83 discovered fixtures from the original
failure catalog ran at two jobs, one indexing thread, 30-second deadlines,
zero retries and native-status redo disabled. The historical runner receipt is
`.testLogs/run-1792349605692-303wwh`: 73 passed, six failed and four timed
out. Two failures were Linux-only ELF/clangd positive fixtures inadvertently
included in the Windows selection; their Windows unsupported-platform and
portable authority owners passed separately. Four report failures traced to a
task-created `.testCache/retrieval-parity/repo` nested under the `sample`
fixture by the earlier parity wrapper. Default indexing now excludes
`.testCache` and `.testLogs` trees; report fixture copies filter them as well,
and the ignore contract checks source-only discovery. The four original report
cases then passed individually in 16.9-17.6 seconds. This is a real cache
admission fix, not an expected-count update. The nested historical scratch
directory remained on disk at that intermediate observation; automatic approval
review rejected a bounded recursive cleanup command. A later inspection during
the workspace-layout continuation found the nested path absent.

Serial follow-up cleared the compiler-binding and API semantic-detail
timeouts. The incremental SSR forward-witness case still exceeds 30 seconds;
one serial run of its companion parity case finished in 29.9 seconds, while two
later repeats also timed out. Timing markers on a diagnostic artifact-only run
showed a cold published build at 15.1 seconds and cold forward-trace inspection
at 20.3 seconds, before the incremental build. Reduced ambient TypeScript
declarations lost the actual modeled MessageChannel/interpolation evidence;
skipping identical fixture writes and disabling SQLite did not close the time
budget. Those experiments were reverted. The exact witness assertions and real
Node declarations remain. The nine aggregate script-coverage wrappers also
need bounded action ownership; the nested runner already receives zero retries.
No 30-second timeout is counted as passing evidence.

On the cache-exclusion tree, a serial five-case cohort passed the original
sample, mixed and showcase eval corpora, fixture parity, and the report
all-mode integration in 16.6-25.2 seconds with no failures, timeouts or skips
(`.testLogs/run-1792350822624-r5v120`). A direct four-way script-coverage
embeddings shard still exceeded 30 seconds after completing two actions; it
was stopped, so finer action boundaries are required before that wrapper can
count as acceptance. No group coverage claim was inferred from that partial
diagnostic.

The preceding source passed `npm run format`, `config:budget`, `env:check`,
generated-surface freshness, command-surface audit, workflow contract and all
39 gate fixtures with zero skips (`.testLogs/run-1792351007477-r0zn4h`), plus
`git diff --check`. The first command-surface attempt failed because an
inherited `PAIROFCLEATS_TRUSTED_CONFIG` named a nonexistent external file;
clearing that unrelated shell variable made the identical audit pass. Fresh
`node tools/setup/rebuild-native.js --verify` also exited zero with all
required natives and patches loadable and no warning/error lines. These gates
do not erase the incremental SSR timeout or replace the unrun complete Windows
cohort.

## Workspace layout and remaining timeout repairs

The workspace inspection found `.testCache`, `.testLogs`, `.benchCache`, `.c8`,
`tests/.cache` and `temp` correctly ignored, with no tracked files in those
generated roots. An empty `.tmp` lacked an ignore rule. A single lightweight
development-path owner now places test caches at `temp/dev/tests/cache`, V8
coverage at `temp/dev/tests/coverage`, and disposable benchmark workspaces at
`temp/dev/benchmarks`. The remaining `tests/.cache` producers use that owner.
Product OS caches and `.testLogs` receipt paths are unchanged. Legacy cache
directories were moved into the ignored author-workspace archive
`temp/legacy-dev-artifacts-20261018`, whose `relocations.json` preserves the
original paths. The combined archive/delete command was rejected by automatic
approval review; narrower reversible literal-path moves and an exact
nonrecursive empty-directory removal succeeded. Legacy ignore rules remain.
Seven initial path/authority checks pass; a further 28 layout checks pass,
with uninstall separately selected rather than counted through a destructive
tag exclusion.

SSR trace profiling isolated repeated query-index file validation and row reads
in the lower/upper range searches. Related-page requests now share bounded
validation promises and row reads within that request only. The next request
revalidates both data and offsets. On the same preserved published witness,
forward traversal fell from 4240 to 1556 ms, retaining all 115 records, 136
edges and SHA-256 `16ef1f09092ea72667e677489ce3ed9b78c3f130f4923406cfb0095fe5b1036b`.
The six-case serial cohort passes: cold SSR 16.9s, exact incremental witness
25.3s, incremental artifact/SQLite parity 28.2s, runtime query integrity,
tamper recovery and trace parity (`.testLogs/run-1792366347083-jx8z8u`). The
trace-parity regression edits same-size query-index data and offsets between
warmed related-page calls and requires rejection, then verifies recovery.
No producer meaning changed; no semantic version bump is required.

The action inventory contains 210 original script-coverage actions: 181 invoke
direct fixture scripts, and only four actions retain claims against the current
21 package scripts. No assertion was removed. Generated sidecars expose each
action as its own discovered process case. The full sample build is partitioned
into four concrete modes while `cli/build-index/all` retains one-call all-mode
dispatch; the original shell checks have a separate boundary: 214 cases total.
Group prefixes select every case, each has a fresh
cache and a 30-second bound, nested retries are explicitly zero, and nested
optional skips now propagate rather than being reported as passing coverage.
CLI actions with a preceding-index dependency prepare a fresh stage-1 sample;
the parity action now explicitly targets that same sample. Sidecar freshness
and invalid/duplicate case rejection have coverage. No affected aggregate ID
was present in the checked-in ordered-lane files. The first 15-case cohort,
including all ten embeddings actions, passes without skips
(`.testLogs/run-1792366598677-l4n28s`).

The independent workflow cohort exposed a production stage-4 defect: batching
four modes into `all` occurred before authority resolution, which then looked
for a nonexistent `index-all` root. A new all-mode CLI regression failed before
repair with that exact error (`.testLogs/run-1792366937788-sp8us7`). Stage 4
now resolves every concrete mode first and batches only modes with the same
authoritative root; mixed-generation roots remain separate. CI export and
restore pass after the fix, as do both existing stage-4 publication-authority
fixtures. The CLI regression also checks positive code/prose/record SQLite rows
and the authoritative zero-state marker for an empty extracted-prose mode.
The script runner now streams output through the tracked subprocess owner so
watchdogs retain the last child phase instead of losing a spawnSync buffer.

## Complete script cohort and second repair batch

Source candidate 01 was frozen at base HEAD
`ab00d918d77fd45c086831e9759d7596ac18a16d`, with all 5789 non-document
tracked/nonignored source paths (including deletion markers) hashed to
`23c1f1e1036f6f3c7b4be45b4d0f83917663e166e66d067371aa7f3b395dab11`.
The manifest and raw reports live in the ignored author-workspace task directory;
they are historical evidence, not clean-checkout inputs. The source digest was
verified again after the complete 214-case script cohort. That run passed 211,
timed out once, and reported two expected exclusions in 1326.6 seconds, with
zero assertion failures or native crashes (`.testLogs/run-1792367465141-c0aide`).
Optional sqlite-vec was unavailable, and Bash could not execute the shell helper.
The only timeout was the four-build tokenization-cache wrapper.

Three independent two-build comparisons now retain stable-config cache reuse,
phrase-ngram invalidation and dictionary invalidation, including fresh child
processes and the ordered ci-long membership. The unbounded direct aggregate
remains a diagnostic entrypoint; discovered acceptance uses the three cases.
No assertion or cache transition was dropped. Script actions select each same
comparison explicitly. Two additional actions execute the exact config-budget
and environment-check npm commands. The old help, partial bootstrap and baseline
smoke controls remain executable but no longer claim a different package command.
Locked bootstrap readiness and the suite orchestrator have separate evidence
owners. Sidecar freshness and actual command/claim equality are asserted.

Four new regressions failed before this batch (`.testLogs/run-1792369222544-8bpnmz`):
mixed-mode stage-4 publication, nightly dispatch, nested skip reasons, and partial
npm coverage claims. Nightly had ten references to removed aggregate filenames;
it now selects each actual discovered group through the runner with one job,
one indexing thread, 30-second bounds, zero retries and native-status redo off.
Nested skips retain an explicit child reason rather than a wrapper label.

The mixed-mode fixture first published all modes, then a newer code-only
generation, then requested all-mode SQLite completion. Promotion incorrectly
validated prose at the new code root. The existing promotion owner now validates
every concrete root before one atomic publication and preserves every mode pin.
Only modes in the primary root receive that root's semantic acknowledgement.
The positive query then exposed a second defect: latest SQLite lookup used the
global root for prose. SQLite and LMDB paths now follow the requested mode's
published root; explicit as-of mixed-root rejection remains unchanged. Cold and
warm SQLite queries retain positive source assertions. Outside-cache, incomplete,
invalid, extra-mode and unanchored mode maps must reject without altering the
current pointer. The mixed-mode fixture passes in 21.5 seconds. No public knob,
artifact schema or semantic producer meaning changed.

CI-suite cache/home defaults also use `temp/dev/ci/`; explicit hosted cache roots
and `.diagnostics`/`.testLogs` receipt interfaces remain supported. Their legacy
roots remain ignored. This second batch supersedes candidate 01 for acceptance;
its earlier greens cannot qualify the newer source by themselves.

Candidate 02 passed the complete front gate (39 gate fixtures,
`.testLogs/run-1792369680279-p71el9`) and fresh native/patch verification with
no warning/error lines. Its source hash was
`245f5868ff24bc6887d2e76e6649ca40efd5c0bf8a111fa90682a6d8c8453e86`;
discovery accounted for 2982 cases, 2971 required and 11 explicit exclusions.
The task-local capable launch proved actual file-symlink creation, then passed
44 of 45 selected cases without skips or timeouts
(`.testLogs/run-1792369743002-9b80l6`). Windows UAC applied to that RunAs launch;
Codex filesystem access does not grant the Windows file-symlink privilege.
No machine policy changed.

The one failure was bootstrap admission, not a symlink failure: the workspace
path migration added a statically linked repository helper before the readiness
guard. The incomplete-checkout regression correctly rejected the resulting
`ERR_MODULE_NOT_FOUND`. The runner, CI suite and affected benchmark entrypoints
now dynamically load that helper after readiness succeeds. The regression
executes every guarded index/SQLite benchmark entry plus the existing CLI/test/
microbench and CI-suite entries, requiring both absent-setup rejection and
prepared-workload admission. It passes in 11.3 seconds; all four affected checks
pass (`.testLogs/run-1792369912602-17lurr`). Its executable-link check is POSIX-only,
so Windows admission coverage now runs in the ordinary-token cohort. The 44
actual Windows file-link cases retain their capable-token owner. Candidate 02
remains a failed historical observation; the admission repair requires a newer
source identity and affected acceptance checks.

Candidate 03 (`190d357915cfc8e52836033b9eaa465bb432e4fc9abbc51e1f89b04bffb6e48c`)
passed its refreshed front gate (`.testLogs/run-1792369988241-dgq8ru`). Four
ordinary cohorts passed 306 cases; the next serial cohort passed eight and
timed out at context-pack risk-filter parity. Its 42 remaining cases were
unexecuted through fail-fast, not legitimate platform exclusions. The test
finished index teardown but combined several CLI/API/MCP scenarios inside one
deadline. A following diagnostic exposed a second defect: forced timeout during
the degraded-artifact scenario left a mutated manifest, and the fixture helper
admitted it using an old compatibility-only health stamp.

The cold/warm/tamper regression failed before repair
(`.testLogs/run-1792370445894-41lbyk`). Fixture health version 6 binds its claims
to the current mode root, pieces manifest and the contents of the health-input
artifacts, with bounded reads and path containment. Positive risk/watch claims
cannot merge across changed authority. Manifest removal and same-size flow-data
tampering each cause a real rebuild and restore positive risk-flow evidence;
an unchanged warm cache preserves its published generation. Both independently
bounded cases pass in 19.3-19.6 seconds. The focused regression uses the existing
fast indexing fixture configuration because it qualifies cache admission; native
parser qualification stays with the native fixtures.

Risk-filter parity is four explicit cases retaining all original assertions,
ordered CI membership, positive filtered results and CLI/API/MCP comparisons.
The degraded and invalid cases first execute the positive request, preserving
the warmed-cache boundary. Every case closes its real HTTP harness. Phase traces
show teardown completing, with fixture setup and repeated CLI startup accounting
for the aggregate cost. The four cases pass in 21.4-23.6 seconds
(`.testLogs/run-1792370708843-q7rfez`). Missing risk flows now fail rather than
being converted by catch-all handlers into a successful “skip”; the same
repair applies to risk-explain parity and its adapter matrix. Those related
checks, both health cases and complete/ordered discovery pass
(`.testLogs/run-1792370856253-jakptq`). No retry, larger deadline or production
backend switch was used to qualify the original parity scenarios.

Candidate 04 (`cc79c71b92e1dfb710f12075d33beb26d2b9959a7bf6d794864a4a960d874aa4`)
passed its front gate (`.testLogs/run-1792371018870-fmyqot`) and six explicit
ordinary cohorts: 389 passes, zero failures, timeouts or skips. The campaign
stopped intentionally between cohorts after a path audit found a remaining
reader migration defect. Replay report discovery still scanned only the old
cache roots, so it missed both current development roots. The expanded existing
replay regression failed before repair (`.testLogs/run-1792371931149-vwqbcn`).
Default discovery now visits current test and benchmark roots before legacy
roots. Basename filtering, the existing report-count bound, malformed-payload
coverage and streamed/loaded aggregation comparisons remain. No source changed
while the completed candidate-04 cohorts were running; their receipts remain
historical qualification rather than a pass for the newer reader source.
The repaired replay test, unchanged replay budget, SLO gate smoke check,
development-path contract and shared-module budget pass
(`.testLogs/run-1792371956348-v7ehh7`). Candidate 05 passed formatting, config
and environment budgets, generated freshness, command/workflow contracts,
all 39 gate fixtures (`.testLogs/run-1792372090547-stbh8b`) and diff whitespace.
It is frozen at `523b6b2805c50ea736b3838453a6ce9d137ce34aa84fa441c3a245f4363c93a5`
across 5796 non-document source paths, on the same base HEAD and Node 26.10.0.
All 2987 discovered cases are accounted for: 2976 Windows-required and 11
explicit exclusions. The ordinary-token campaign stopped deliberately between
cohorts for the subsequently authorized publication batch. Ten cohorts completed:
723 passes, two assertion failures, zero timeouts, native crashes or skips.
The failures are the shared-module review inventory and watch consistency state
(`.testLogs/run-1792372447957-m8aybe`). The curated review inventory now includes
the reader-admission leaf and development-artifact path owner; its focused check
passes (`.testLogs/run-1792372669269-bwf6yu`). The watch case observes an in-memory
consistent snapshot before its queued persistence completes; its original
persisted-state assertions remain pending investigation. The 44 actual file-link
cases still have their separate capable-token final-candidate owner. Unexecuted
cases remain pending; no whole-suite pass is claimed.

## Publication batch

The user subsequently authorized incremental commits and pushes on the existing
branch and updates to PR #572; its verified integration base remains `main` at
`a8c19738eb236032a56f2ac6d583b799508d5d67`. Commits `6b67c4495`, `f8212363e`
and `5b34271c4` separate native/runtime repairs, development paths and bounded
discovery, and correctness/authority repairs. Documentation is a separate
commit. Original failure receipts and task-local caches remain ignored.

Publication whitespace checks caught an unused final context line in the new
node-pty patch and trailing blank/space-only lines in three new source fixtures.
Those formatting repairs preserve behavior. Fresh native/patch verification
exited zero with no warning or error lines after trimming the patch context
(`temp/tasks/windows-deep-repairs-20261018/publication-native-verification.log`).
These edits and the changed Git identity require a new qualification candidate;
candidate-05 observations remain historical, including its two failures.

The publication front gate passes on the committed repair source plus this
documentation batch: formatting, configuration budget, environment usage,
generated freshness, command surface, workflow contract, all 39 gate cases
(`.testLogs/run-1792372909769-mwpmzl`) and whitespace checks. This front gate
does not imply that the unfinished deep or platform cohorts passed.

## Remaining acceptance work

### Watch persistence follow-up

The watch consistency failure is a stale fixture synchronization assumption.
`emitWatchState` publishes memory and callbacks before adding the disk write to
its persistence chain; shutdown already joins that chain. The fixture read the
file immediately after observing memory, so a valid queued write could still
leave `catching-up` on disk. A task-local hook delaying consistent-generation
writes by 250 ms reproduces the original assertion before repair
(`watch-consistency-fail-before.log`). The fixture now observes live disk
convergence within the existing five-second condition bound, retaining all
memory, backlog, generation and persisted-state assertions. The watch remains
running during the disk check. The shared condition helper awaits asynchronous
predicates instead of treating any returned Promise as true.

The same delayed-write control passes afterward
(`watch-consistency-delayed-pass-after.log`). A second control suppressing all
consistent-generation writes still fails at the five-second bound
(`watch-consistency-stale-negative.log`), proving that permanently stale
persistence is rejected. Those diagnostic logs are task-local historical
evidence, not discovered suite cases. All 25 watch fixtures pass normally with
zero retries, skips or timeouts (`.testLogs/run-1792373022960-e5ev5p`). No
production behavior, state schema, condition deadline or public option changed.
The complete front gate also passes for this follow-up, including all 39 cases
(`.testLogs/run-1792373141842-gcoagt`) and every preceding required check.

### Final campaign

The access violation is attributed to Node's freed-Realm cleanup and the focused
post-fix closure above is complete. The capable Windows symlink launch and safe
uninstall prerequisite are now satisfied. Full Windows-suite acceptance is still
open: several original service/storage/script-coverage wrappers and timeouts
have not passed on the final tree; explicit discovered cohorts, serial measured
performance and candidate freeze remain. The two C/clangd ELF-positive fixtures are Linux-owned; Windows
unsupported-platform and portable authority coverage pass separately. Optional
sqlite-vec, real-model evaluation, Linux/macOS and release qualification remain
outside this Windows target. No security settings, debugger registration or
merge have been changed. Publication verification and hosted final-head CI
are reported separately from Windows deep-suite acceptance.
