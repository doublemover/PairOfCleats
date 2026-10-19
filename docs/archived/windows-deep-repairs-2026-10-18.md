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

### False-green and macOS setup follow-up

Watch repair `7ca0759f8ffc935501d4ceabced799153c88a560` was pushed and PR #572
read back at that exact head. Candidate 06 froze 5794 non-document paths at
`32d60c36174c332fa9b7d9d910bda2c1aadd55653c2b535f91dc4aa44c37ee01`, with
documentation digest `f4a668a1e2ae1f17a11a64c50db42b83156a863bcc593e32dff470d64a72ee41`.
Twelve cohorts reported 810 passes and no failures, timeouts or native crashes.
The source audit found that one was a POSIX-only opt-out exiting zero; it is
not Windows passing evidence. The campaign stopped deliberately between
cohorts after `.testLogs/run-1792373592390-22g2nv`; no active fixture was killed.

The AST audit records 54 actual zero-exit calls, excluding embedded child source
strings, in task-local `zero-exit-source-audit.json`. Most are dependency guards,
non-Windows guards or successful parent/child roles. Two branches could hide
failures: the postings benchmark returned zero on `ETIMEDOUT`, and the advanced
API golden fixture returned zero when its baseline was missing. The original
real fixtures both return zero under bounded controlled fault injection
(`postings-timeout-false-pass-before.log` and
`advanced-golden-missing-false-pass-before.log`). The golden file was preserved.
Postings now delegates timeout/nonzero handling to the existing `runNode` owner,
which makes its old duplicate failure branch unnecessary. Its real baseline
assertion and deadline remain. Golden admission fails before expensive setup;
its content comparisons and nonzero missing-file diagnostic remain. New
timeout/nonzero/success and missing-baseline controls pass
(`.testLogs/run-1792374763468-68zsww`) and have explicit ordered CI membership.
The first control attempt exposed Windows absolute `--import` URL handling;
the controls now use file URLs. That failed attempt is retained separately.

Five whole-case opt-outs now use canonical skip status 77 instead of success:
three POSIX signal/leak cases, the opt-in repository benchmark scenario wrapper,
and optional Tantivy smoke. Their code/assertions remain intact. The explicit
Windows exclusion inventory grows from 11 to 16, with coverage owners and
qualification limits in the matrix. A disabled opt-in wrapper is not measured
performance evidence, and Windows shutdown coverage does not prove POSIX grace
or signal-injection behavior.

At the pushed candidate, hosted gate, Rust TUI, Ubuntu and Windows jobs pass. The macOS
bootstrap job fails its real PTY probe with `posix_spawnp failed`
([job receipt](https://github.com/doublemover/PairOfCleats/actions/runs/39185353401/job/117847983726)).
The node-pty 1.1.0 archive exactly matches locked SHA-512 integrity and packages
both Darwin spawn helpers at 0644 (`node-pty-darwin-helper-mode-proof.txt`).
The production loader selects those prebuilds; its rebuild script previously
checked only directory existence. This matches
[upstream issue #850](https://github.com/microsoft/node-pty/issues/850).
The dependency patch restores execute bits on the regular helper during rebuild,
leaving verify-only probes read-only. Actual macOS spawn/disposal acceptance
must pass in the next hosted run; no macOS closure is claimed from Windows.
The first local migration bootstrap rejected the newly added patch section's
missing index header. The second rebuilt and probed native packages, then
correctly refused readiness because the append hunk could match again after
application. The corrected hunk has explicit original context and an unambiguous
final-line annotation. Applying, verifying and reapplying the exact locked input
preserves identical bytes (`pty-helper-patch-idempotence-02.log`); the patched
script Git blob is `6d96cb0d2c5d04407a7665a0161c22a91f20018a`.
Both failed bootstrap attempts and the original archive remain preserved.

The third `npm run bootstrap:ci` exits zero with no warning/error lines
(`bootstrap-ci-helper-repair-03.log`). Fresh verify-only setup also exits zero
without warnings/errors (`reporting-helper-native-verify.log`), verifying 37
required packages and activating 33 language routes on Node 26.10.0, ABI 147,
Windows x64. The refreshed readiness receipt SHA-256 is
`06ad4ad4d0b499f02784d3a53caed4e0c847c803adaf34eb67f82c3be550b39a`.
Thirteen focused cases pass, including the real benchmark/API positives, new
guards, VM lifecycle, all three ConPTY lifetimes, discovery and coverage contracts
(`.testLogs/run-1792376043964-fwwg5m`). Five separate declared-exclusion controls
return exactly 77; they are not counted as required-case passes. The two cheap
guard regressions belong to regular cross-platform `ci-lite` (959 cases), with
the real benchmark retaining its medium-lane ownership. Generated inventories
are refreshed. The final front gate passes every required command and all 39
cases (`.testLogs/run-1792376369863-vwc3jc`). No host security policy,
dependency version or public configuration surface changed. The resulting
committed source still needs its complete Windows cohorts and hosted macOS probe.

### Candidate 07 and the following repair batch

Candidate 07 froze commit `6ccc3034fc264c891ee14b1df61d43b18a523234`,
5796 non-document paths at SHA-256
`d05f02285257f98016fe59b7864aa078b0a813fc066b491cc751c88ec077ecb9`.
Its 44 ordinary-token cohorts completed: 2920 required passes, eight failure
receipts, three skips, no native crashes, and 44 capable-token cases pending.
One skip was unexpected: the optional Tantivy script-coverage wrapper was
missing from the 16-case exclusion inventory. Its exact smoke action is now
mapped alongside the direct fixture, increasing the next inventory to 17.
The original inventory and failure receipts remain unchanged. All 101
ordinary-token performance fixtures passed serially; three file-link-dependent
performance fixtures remain in the capable-token cohort.

Three TUI failures were missing Cargo from the task's inherited PATH. Cargo and
rustc 1.93.1 were installed; selecting their existing directory made the exact
build, frame-capture and headless fixtures pass at their original deadlines
(`tui-cargo-corrected-07.json`). The task PATH now also selects installed Graphviz
for its real SVG checks. This changes no machine configuration. The completed
script-coverage cohort passed 215 cases and reported its three explicit optional
or helper skips. All six hosted jobs pass at `6ccc3034f`, including macOS.

The next source batch repairs three demonstrated correctness defects:

- Managed-tool digests could reuse stale bytes after same-size timestamp
  collisions. Of 64 real Windows controls, 51 collided and returned the stale
  digest. Hashing now always reads current bytes with the existing bounded
  buffer, file-size and opened-file identity checks. A deterministic regression
  fixes metadata while changing the actual file contents.
- Generic offset validation also admitted timestamp-only cache hits. It now
  checks current boundaries with the original fixed 64 KiB scratch and sparse
  reads. Its old zero-read warm-cache assertion is retired because it required
  unsafe admission; the existing bounded-read assertions remain. Semantic
  readers freshly hash data and offsets before reusing bounded boundary-check
  metadata. Same-size, fixed-stat tampering and forged offset checksums fail.
- Either JSONL peer open could fail while leaking the other successful handle.
  Rejection now awaits both opens and closes every successful peer; four actual
  file-handle controls cover both APIs and both failing paths.

The API allowlist fixture now derives the real consolidated implicit-cache root,
tests a positive inside it, and chooses its rejected path outside every admitted
root. Production admission and its invalid-ID/cache/workspace negatives remain.
Six shipped runtime targets and the current changelog now match the existing
Node 26.10 floor. LSP initialization negotiates standard position encodings by
default and sends the deprecated extension only for an explicit caller; wire
tests retain both routes. Sublime uses timezone-aware UTC and its Python
scenarios reject deprecation warnings. Cache-corruption and lock-hook warnings
are asserted; the lock's missing-parent race is injected deterministically and
must increment recovery counters. Suppressing that injection fails the control.

The language registry now loads the 38 vendor entries used by its routing policy
instead of all 801. Every ordered extension route (195) and filename route (106)
matches the original catalog, and the regular CI fixture compares against that
complete catalog. Vue, Svelte and Astro parsers load on actual use; four original
fixture outputs match exactly and load failures still propagate. A diagnostic
fresh import fell from 3658 modules / 3861 ms to 2308 / 2692 ms; these are local
observations, not a new latency threshold. No vendor entries or language routes
were removed, and semantic output meaning did not change.

Ten actual-source correctness fixtures pass in
`.testLogs/run-1792385339043-1rvqdh`; tamper recovery and trace parity also pass
after content-keyed boundary reuse in `.testLogs/run-1792386814861-cgr614`.
The retained SSR graph still exactly matches 115 records / 136 edges and digest
`f58f587a9ad0d9b0c24e64062b540f396b70629ceab805f68d0b6c83da96fb31`.
Both full SSR witnesses still exceed 30 seconds. Isolated phase diagnostics
show repeated build and graph-reader I/O, with immediate exit after cleanup;
they do not attribute these timeouts to leaked teardown. Their original inputs,
two builds, content comparisons and deadlines remain. No final-tree suite pass
is claimed from the exploratory or focused observations.

Remaining warning owners include docx's bundled browser deprecation helper
touching Node's experimental localStorage getter, expected unavailable/untrusted
provider diagnostics, and actual Graphviz execution after correcting PATH. Both
official docx Node entry formats reproduce the warning; changing import syntax
does not fix it. Those qualifications and the full final-candidate campaign
remain open.

The actual Sublime harness and three language-routing/segmentation fixtures
pass (`.testLogs/run-1792387088894-n9iv7k`); Python scenarios emit no deprecated
UTC warnings. Five cheap regression owners now have explicit regular CI
membership, bringing `ci-lite` to 964. Generated lane evidence and the release
guide are refreshed through their owners. The checkpoint front gate passes
formatting, config budget, environment usage, generated freshness, command and
workflow contracts, all 39 gate cases, and whitespace checks
(`.testLogs/run-1792387219213-ur264f`). This is checkpoint validation; both SSR
timeouts remain open.

### Scoped reads, DOCX compatibility and default provider controls

The checkpoint was committed as `b5f674fad`, `6a96beb19` and `3469c6228`,
pushed through `3469c6228cdd5583251e99e7da1758d4dba46380`, and PR #572 read
back at that head with updated scope and remaining failures. All six hosted
jobs subsequently passed at that exact head.

Graph queries now share at most four JSONL handle pairs within one related-page
request. Overflow pieces use the existing bounded reader. Both concurrent bound
searches settle before cleanup, including on rejection; no handle or row cache
survives the request. Content hashes and physical path authority are checked
again for the next request. Concurrent positioned reads retain byte limits,
ordering and duplicate ordinals. The strengthened fixtures assert disposal on
success, invalid cursors, cancellation, tampering, failed reads and either peer
open failure; related-page peak handles remain bounded. Parallel semantic hashes
also settle both owned operations before propagating a failure.

On the retained published fixture, the complete forward/reverse artifact/SQLite
graph remains exactly equal at the preceding 115-record / 136-edge digest.
Serial diagnostic time changed from 2888 ms to 2549 ms
(`retained-ssr-before-scoped-readers-02.json`,
`retained-ssr-after-scoped-readers-01.json`). The unchanged original SSR cases
then pass in 29.9 and 29.1 seconds, zero retries, no native redo
(`.testLogs/run-1792387517463-khf74c`). This small margin is recorded explicitly;
it is a focused observation, not whole-suite or representative-load acceptance.

The actual warning stack in docx 9.5.3 reaches bundled browser `util-deprecate`
through Node's unconfigured experimental localStorage getter. ESM and CommonJS
both reproduce it. Original bundles and SHA-256/Git-blob identities are retained
in `docx-patch-source-proof-01.json`; the reviewed 1482-byte patch changes only
their Node flag lookup. Browser distributions remain intact. Disposable locked
copies pass apply, verify-only and repeat application
(`docx-patch-idempotence-01.log`). Both strict regressions fail before the repair
in `.testLogs/run-1792387671259-f7rlua`. Afterward, fresh processes using both
official exports generate real DOCX files with no warnings or browser-storage
access. The existing real Mammoth extraction/conversion/image/argument suite
passes with parent warnings asserted, retaining all original comparisons.

The new locked bootstrap completes (`bootstrap-ci-docx-compat-01.log`). Its
launch used obsolete `npm_config_devdir`, producing npm configuration warnings;
that attempt is preserved and is not a warning-free setup receipt. Subsequent
verification uses the supported `npm_package_config_node_gyp_devdir`, exits zero
and contains no warning/error lines (`native-verify-docx-compat-01.log`). It
verifies 37 required packages and activates 33 language routes on Node 26.10.0,
Windows x64, ABI 147. The readiness receipt SHA-256 is
`b7b0a009b09504e1cbd76035d3d7f772bcc96d96973a32acd1d4e741d8ed99d5`.
This is activation and bounded-operation evidence, separate from full lifecycle
and platform qualification. No dependency version or lock resolution changed.

Fresh API/provider diagnostics now reject unrecognized warnings, missing routes,
old snapshots, crashes, protocol failures and request timeouts. Six task-local
fault controls reject their initiating defects. The real API, observability and
build-script routes retain default worker/provider selection and expect only
the documented optional-command or Rust trust diagnostics. Pyright must report
healthy real requests, with zero failed or timed-out methods; unavailable
providers cannot claim live execution. Installed Graphviz executes the actual
SVG assertions in both direct and script-coverage smoke fixtures.

These assertions expose a previously tolerated fresh Pyright documentSymbol
timeout (`.testLogs/run-1792388257993-hie47v`: 12 passes, one failure). The
cross-file pipeline coerced its config owner's internal null sentinels to zero,
then clamped them to a 1000 ms deadline, zero retries and a one-failure breaker.
The declared omitted defaults are 60000 ms, two retries and a three-failure
breaker. Two regressions fail before repair
(`.testLogs/run-1792388514831-ysglbt`). Null lifecycle options also incorrectly
selected minimum values instead of 60000 ms / six restarts / 1500 ms backoff.
Both owners now preserve their existing defaults; explicit controls remain
exact and invalid public null configuration remains rejected. No fixture
deadline was increased. LSP producer version 10 and its cross-file fingerprint
invalidate derived results from the old behavior while preserving syntax reuse.
The fresh real API and observability cases then pass without request failures.
The initial added propagation case used a flat provider result; it now uses the
authoritative payload envelope and retains its positive contribution assertion.
Its invalid-public-null control remains part of the regression.
All five final focused provider/default cases pass in
`.testLogs/run-1792388743260-8g8rx0`, including both real API wrappers and the
build-code script action. The separate producer/cache/lifecycle/metrics checks
pass in `.testLogs/run-1792388648420-pr82hd`; that run's initially invalid public
null fixture remains a recorded failure, corrected to an asserted rejection.
After formatting and the producer update, both original SSR cases pass in
26.1 seconds in fresh processes, with unchanged inputs and zero retries
(`.testLogs/run-1792388974518-vn4m30`). The latest ordered `ci-lite` inventory
contains 966 cases, adding the DOCX compatibility and null-lifecycle guards.
The complete batch front gate passes formatting, config budget, environment
usage, generated freshness, command/workflow contracts, all 39 gate fixtures
and whitespace checks (`.testLogs/run-1792389070227-cakuue`). Full frozen-source
Windows cohorts and capable-token authority qualification remain outstanding.

### Candidate 08 and bounded semantic format coverage

Frozen head `354c58e8eb1cfa6f2576661f7071e7d8a44a63c9` has source SHA-256
`9084276241edfdab74f1e9505a606aa433649442012491dc86fa07e3224adfbb` across
5802 non-document paths; documentation was separately frozen at
`36b8effb6d537114dac0c17337dc58d8f5b33eeeee67f9caee6d7fd8fb994d72`.
All six hosted jobs passed at this exact head. The explicit discovery maps
2991 cases: 2974 required and 17 declared exclusions, across 47 cohorts.
The campaign stopped after the services cohort: 539 required passes, one
30-second semantic-detail timeout, 2434 unexecuted required cases, zero native
crashes and zero unexpected skips. Source identity was verified unchanged after
the stop. These partial results do not qualify a later repair tree.

All 44 real file-symlink fixtures pass on candidate 08 under the task-local
administrator launch, including all three link-dependent resource fixtures.
The launch first creates and reads an actual file symlink; it does not substitute
a junction or change security settings. All 101 ordinary-token performance cases
also pass serially, and the full original SSR witnesses pass in 26.0 / 25.5
seconds. For SQLite search, both `greet` and `answer` retrieve `index.js` before
and during every warm sample. Its 20 raw warm search-path times in milliseconds
are:

```json
[234.3272,225.4949,234.9633,243.065,226.1739,235.1671,225.9879,247.6965,232.519,226.5571,222.712,236.1106,226.6837,213.6665,216.5498,225.9823,236.3114,235.5209,216.6796,222.0153]
```

The observed p95 is 243.065 ms against the unchanged 7500 ms Windows threshold.
This measures a tiny-fixture warm search path using SQLite, not an isolated SQL
statement or representative repository load. The raw owner log is historical
`.testLogs/run-1792390183352-phzhva/perf_sqlite-p95-latency.attempt-1.log`.

The original semantic-detail aggregate completed at 31.1 seconds with exit zero;
it remains a timeout (`.testLogs/run-1792390620153-mi6k9y`). A bounded diagnostic
reproduces the deadline while doing work: imports complete at 6.30 s, builds
take 8.05 / 5.85 s, the first three CLI calls take 2.37 / 2.07 / 1.93 s, and the
fourth starts at 29.21 s (`.testLogs/run-1792391442078-az4vgn`). Build teardown
has completed; this does not attribute the failure to a leaked shutdown handle.

The positive test retains its original ID, HTTP/MCP pagination and invalid
generation/include/cursor checks, real CLI all-pages comparison and retained
generation after a second real build. Three independently discovered
`services/api/semantic-detail-format-compatibility/{missing,legacy,future}`
cases retain the original version inputs and every HTTP/MCP/CLI diagnostic
field comparison, plus semantic-manifest rejection. Every case still performs
two real builds and corrupts the retained requested generation after the
current pointer has moved. Shared fixture setup asserts that retained generation
is readable before corruption and closes the real server/router and scratch
root. Each process keeps the original 30-second limit and zero retries. The
original fixture had no ordered-lane or script action membership; its ID and
both API/services rule memberships remain, and the new cases inherit both.
No production contract or format admission changes.

Two warning-owner controls also expose false positive tests. The old download
fixture passes when valid ZIP/TAR downloads succeed but both malicious archive
requests return unrelated HTTP 404 errors (two verified injections,
`.testLogs/run-1792391494681-6syl33`). The old SQLite fixture passes after its
real missing-pieces rejection is replaced by an unrelated error while preserving
the failed state (one verified injection,
`.testLogs/run-1792391611424-8ppo78`). An earlier SQLite injection targeted an
unused error route and recorded zero substitutions; it is retained as an
ineffective control, not proof. The repaired fixtures reject these same faults
in `.testLogs/run-1792391661478-22imzt` and
`.testLogs/run-1792391667119-q46nnm`. Download rejection now requires status 1,
no signal and the specific unsafe-entry/missing-binary cause through the existing
bounded subprocess owner. SQLite requires its authoritative
`ERR_SQLITE_INPUT_PIECES_LOAD_FAILED` classification and missing-chunk message.
Binary bytes, archive hashes, manifests, outside-root absence, failed-state
recording, real rebuild and ready-state assertions remain intact.

All seven affected normal cases pass in
`.testLogs/run-1792391700099-qw8cou`: original semantic-detail 23.5 s, format
future / legacy / missing 22.1 / 22.8 / 23.0 s, SQLite recovery 17.9 s, direct
download 4.49 s and its exact script action 4.61 s. There are zero failures,
timeouts or skips. These are focused results; the next complete candidate must
repeat them. The generated governance audit reports zero missing IDs,
duplicates, manifest mismatches or timing overruns; ordered `ci-lite` remains
966 cases.

The repair batch's full front gate passes formatting, configuration budget,
environment usage, generated freshness, command/workflow contracts, all 39 gate
cases and whitespace checks (`.testLogs/run-1792391918975-dn2yfy`). This gate
does not stand in for the complete Windows campaign.

### Candidate 09 and format-fidelity build scope

Two granular commits, `94b6c578c` and `cb1ecbc0c`, were pushed and the remote
head verified as `cb1ecbc0ced2091c24d48a26501bd43b03d8efe9`. PR #572 was updated
and read back at that head; all six hosted jobs passed. Candidate 09 freezes
5805 non-document paths at source SHA-256
`fdad840e66e2bd99c66c980a612e26695fdef0941bdb18e8b646776129b2e410`, and verifies
documentation SHA-256
`1240b67462fb614b1f0baa1df63d50cea054e56845e3bac0f069f44aa0159ca1` too, including
runtime schemas. Discovery maps 2994 cases: 2977 required, 17 exclusions and 47
cohorts. Both service cohorts pass all 120 cases. The original semantic-detail
case passes in 23.1 s, its future / legacy / missing versions in 21.6 / 21.8 /
22.1 s, and semantic trace in 27.2 s. These are candidate observations, not
earlier focused results combined into a whole-tree pass.

After two script cohorts the campaign stops with 277 required passes, one
format-fidelity timeout, two declared optional skips, zero unexpected skips or
native crashes, and 2699 unexecuted required cases. Both frozen hashes were
verified unchanged after stopping. The original receipt is
`.testLogs/run-1792393567952-fla3m8/tooling_script-coverage_language_format-fidelity-test.attempt-1.failure.json`.
The exact wrapper reproduces the 30.4 s timeout in a bounded phase diagnostic
(`.testLogs/run-1792394158675-s6b74s`); it is still doing downstream build work.
The first failure's 303 cache files (10.6 MB) and their SHA-256 inventory are
preserved before its fixture clears that cache.

The fixture's 16 positive content assertions read only code/prose `chunk_meta`
and `file_meta` artifacts. A task-only control stops the same real CLI build at
stage2, keeping every assertion and fixture input. It passes in 16.1 s. Every
decoded field and row order exactly matches the original completed build: 56
code rows, nine prose rows and both complete file maps. Nothing is suppressed
as provenance. Stable-object-key hashes of the complete row arrays are
`c46df4a906a1c3c10cbbb8e4f490b8577fe74257a33ba7e60295ee2a9a953fab` (code) and
`eda2c14bdc7e598226dde4efec1f8d566c52193028cac414866c8a9d4e8fd88e` (prose).
The control reports metadata loaded at 15.700 s, assertions done at 15.702 s and
natural process exit immediately afterward, with only output pipes remaining.
This demonstrates an oversized build scope rather than a shutdown deadlock.

The actual fixture now requests stage2 with no SQLite build and retains its
original ID, ordered CI assignment, exact package-script coverage action and
all 16 assertions. Full embedding/SQLite behavior retains its original owners;
candidate 09's real full-build wrapper passes in 22.4 s, with SQLite build,
incremental, maintenance and search contract cases also passing. No production
backend, public contract or timeout threshold changes.

Thread tracing also confirms the existing documented precedence: configuration
and auto-policy outrank `PAIROFCLEATS_THREADS`. The runner's `--pairofcleats-threads
1` sets that environment hint; it does not prove that every nested runtime uses
one CPU slot. The focused format fixture therefore uses the existing build CLI
`--threads 1`, observes `cpu=1` and retains the normal auto native pool capacity
of 16. Both final direct and exact script fixtures pass in 18.3 / 19.5 s
(`.testLogs/run-1792394362653-xtlgzq`). The complete 65-row/file-map comparison
still matches exactly after that explicit cap. The earlier 14.6 / 15.3 s
metadata-only runs without the CLI cap remain separate diagnostic history.

Formatting and the generated governance audit pass with unchanged lane counts
and no missing IDs, duplicates, manifest mismatches or timing overruns. The full
repair-batch front gate passes configuration/environment checks, generated
freshness, command/workflow contracts, all 39 gate cases and whitespace checks
(`.testLogs/run-1792394584520-e89o4b`). Fresh native/patch verification also exits
zero without warning/error lines (`format-fidelity-native-verify-01.log`).

The current ordinary token again fails an actual file-symlink probe with EPERM
and lacks `SeCreateSymbolicLinkPrivilege`. Candidate 09's task-local elevated
launch remains pending; it has produced no child PID, token receipt or test
result. Candidate 08's 44 capable-token passes remain valid historical evidence,
not candidate 09 acceptance. No policy or security-setting change is attempted.

### Candidate 10, hosted authority and summary ownership

The format repair was committed and pushed as
`cad3825c4865104a2a8754d8def18dfd50ee1562`; the remote SHA and PR #572 description
were read back. Candidate 10 freezes source SHA-256
`53ce6ba8354479078c48b21614d99cf4929aaa14a45a5e09189fe6d0d835306a` across 5805
non-document paths and documentation SHA-256
`da73aeaba0e729d82cab1eaed4d8e6e3061ef416b1c7b25218076bf8abb7f4b9`. Discovery
remains 2994 cases / 2977 required / 17 exclusions / 47 cohorts. The campaign
stops between completed cohorts to close the hosted authority gap, with 236
required passes, zero failures/timeouts/crashes, one declared Bash/jq helper
skip, zero unexpected skips and 2741 unexecuted required cases. Both frozen
hashes remain unchanged after the stop. All 51 serial native/TUI cases pass,
including real quit, supervisor-error and terminal-error lifetimes at
4.43 / 4.13 / 4.39 s. Both serial tooling cohorts pass all 128 cases, including
all seven preserved provider/session routes, normal coupling thresholds,
Sublime behavior/package checks and report partitions.

The delayed candidate-09 local elevated launch eventually returns PID 25540.
Its source guard rejects the changed Git head before any fixture executes
(`windows-file-links-candidate-09.log`, exit 1). This is a stale launch, not a
native crash or current-candidate test observation. No additional local
elevation request or security-setting change is needed for the hosted route.

Hosted Windows already provides the required capability: run
`39211200961` at `cb1ecbc0c` has 22 of the 44 link-dependent cases passing, zero
skips, including the strict file-symlink security fixtures. The downloaded raw
quality artifact is preserved; its slowest linked case is 11.239 s. Those
ordinary CI observations use the existing 600-second lane and are capability
evidence, not strict audit acceptance. The complete cohort now has a dedicated
`windows-authority` job. It checks out and verifies the exact PR head, uses the
exact Node pin and canonical bootstrap/native verification, proves an actual
file symlink, and invokes the canonical runner for 44 explicit IDs at one job,
30-second deadlines, zero retries and native-status redo disabled. It rejects
incomplete/duplicate/mismatched results, skips, late success, nonzero exits,
signals and extra attempts. Source head/cleanliness and dependency receipt
identity are checked after execution. Source/tree, OS, Node/ABI/executable hash,
native readiness, capability, full results and logs are always uploaded.

`tests/ci/windows-authority-fixtures.json` owns the cohort. The new regular-CI
guard checks it against direct link-fixture discovery, preserves the declared
POSIX/helper/Linux-ELF boundaries, and tests fail-closed result/capability
handling. Its focused fixture passes in 1.32 s. Adding this real bootstrap job
correctly breaks the old ONNX job-count assertion, 17 versus 16
(`.testLogs/run-1792396687892-gn72zr`). The updated exact count retains every
per-job CPU/no-GPU assertion, the network-forbidden real vendor installer and
real native CPU inference/release checks; it passes in 369 ms
(`.testLogs/run-1792396736739-3x6bov`). No product CLI/configuration surface or
backend contract changes. The actual new hosted cohort remains unexecuted at
this checkpoint; the guard test does not claim a Windows authority pass.

Separately, hosted Windows fails at `cad3825c4` in
[run 39215761784](https://github.com/doublemover/PairOfCleats/actions/runs/39215761784),
while the other five jobs pass. Both `summary/report` attempts hit the existing
20-second child deadline; the CI lane itself runs two jobs with coverage.
The scan completes in 13 ms, and later indexing work is interrupted. Raw
failure and quality artifacts are preserved under the historical task root.
The local covered original fixture passes in 16.5 s, so that serial run is
explicitly not a local reproduction of the hosted timeout. No retry is closure.

A real negative control also proves a cleanup defect: forcing the original
CLI child to fail once bypasses the helper's `finally` through `process.exit`,
leaving its scratch root present (`summary-cleanup-control-before.json`,
`.testLogs/run-1792397578194-fj3ef5`). CLI failures now return to the caller and
throw with the full bounded child output; the same single injected failure
reaches cleanup and removes the root (`summary-cleanup-control-after.json`).
No failure is converted to success. An added lifecycle regression checks
rejection, cancellation settlement before disposal, environment restoration
and scratch cleanup. Private diagnostic budgets can only tighten the original
20-second limit, never raise it.

The one regular-CI repo/code summary fixture now reuses the existing core
index owner for its asserted code/prose inputs, under an explicit CPU limit and
the same 20-second abort budget. It avoids a duplicate CLI startup and two
unconsumed mode builds. All original artifact-presence and SQLite-count
assertions remain. Seven other sample/model CLI boundaries and the dedicated
all-mode CLI integration remain unchanged. A covered cold-cache comparison
uses the same physical input files and timestamps and clears the cache between
drivers: every input, all 26 code rows, three prose rows, complete file metadata
and all 26 SQLite rows/columns match exactly, with no provenance suppression.
The complete-code/prose/SQLite SHA-256 values are respectively
`45f1d6ffecc70bac66abf7bc9ffbf16b8eb87b32e6a8e58307656ccf8d95a546`,
`28275bd34849c13cd2c9aa22ba5b3392b361f3f2a8231a3238aeb8688229ba55` and
`b6ecf799580a332202250516c9b94ce31eefbd9fcd21bf05878cdee5f89e8119`.
The diagnostic index operation falls from 14.545 to 6.819 s; whole fixture
observations including proof capture are 19.4 / 10.9 s. These small local
observations establish equivalent consumer content and removed fixture work,
not representative production throughput or a precise hosted scheduling cause.

All 18 normal summary/report and exact script cases pass in
`.testLogs/run-1792398241020-oxga0g`, zero failures/timeouts/skips. The main case
is 9.04 s, its wrapper 9.62 s, seven original CLI cases 14.4–17.3 s, and the
new lifecycle guard 2.63 s. Hosted Windows must validate the repair on the next
published source. These focused results do not close the full deep campaign.

The complete publication front gate passes for this repair batch: formatting,
configuration budget, environment usage, generated freshness, command and
workflow contracts, all 39 gate cases and whitespace checks. The post-format
authority, ONNX policy and summary lifecycle cases pass in
`.testLogs/run-1792399240529-q0dp0v`. Fresh native/patch verification exits zero
with no warning/error lines and retains 37 required packages / 33 language
routes. Generated CI-lite membership is 968; the two new fixtures increase
physical discovery to an expected 2996 before the next candidate freeze.

### Final campaign

The access violation is attributed to Node's freed-Realm cleanup and the focused
post-fix closure above is complete. Historical capable Windows file-symlink and
safe uninstall prerequisites pass. Full Windows-suite acceptance is still open:
candidate 10 stopped cleanly to close the strict hosted authority gap, and its
regular Windows CI later exposes the inner summary timeout. The current repairs
require the complete front gate and every required cohort on a new frozen
candidate, including all 44 cases in the strict hosted Windows authority job.
The two C/clangd ELF-positive fixtures are Linux-owned; Windows
unsupported-platform and portable authority coverage pass separately. Optional
sqlite-vec, real-model evaluation, Linux/macOS and release qualification remain
outside this Windows target. No security settings, debugger registration or
merge have been changed. Publication verification and hosted final-head CI
are reported separately from Windows deep-suite acceptance.
