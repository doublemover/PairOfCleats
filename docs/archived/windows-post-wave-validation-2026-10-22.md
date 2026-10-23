# Windows post-wave validation — 2026-10-22

Status: In progress. This receipt records observed failures and repairs, not a
completed deep-suite acceptance. The latest previously qualified production/test
source remains `d4dcba4134f6103e3a59703d90fdbde5ca54d09e`.

## Frozen wave and environment

The final map session batch is 93f25e53c; f14d7526b contains the required ESLint
whitespace-only repairs in 86 files. 50d4ebb45 fixes the GraphQL chunker's missing
brace and invalid editor-fixture setter syntax. c849bf600 fixes downloaded-header
layout selection, node-gyp's literal Python invocation, supported npm child config
and SQLite's redundant legacy source-build environment key. All three Sol6.1/xhigh
agents completed their spans and are parked. The lead owns validation and fixes.

Windows11 build26300, x64, AMD Ryzen7 5800X3D,16 logical processors, Node26.12.1,
ABI147. No Linux/WSL, elevation, machine security changes or physical links are
part of this campaign. Native source builds use the discovered VS2022/MSVC14.44
and Windows SDK10.0.28000.0. No active index was restarted.

Historical author-workspace records are under
`.tmp/tasks/windows-post-wave-20261022/`; they are not promised in clean checkouts.
The task saved installed versions and native binary hashes before replacing the
installation. Swift's scanner and binding have an additional pre-repair hash
receipt. No crash dump was generated for compiler warnings.

## Actual setup and focused observations

- The first locked bootstrap failed at LNK1104 because a downloaded node-gyp
  cache was passed as a Node source checkout. Its actual installed x64/node.lib
  was incorrectly requested under Release/. The repair uses the installed-header
  devdir route. A regression inspects the real generated Windows binding project.
- npm reported one moderate ip-address advisory. The only version resolution
  changed from10.7.3 to10.7.4. Fresh npm install/audit then reported zero known
  vulnerabilities; this is not a hosted security rescan.
- npm11 warnings came from legacy child configuration and an unclassified VSCE
  signing installer. Supported node-gyp package config, explicit locked installer
  policy and SQLite's existing force_build script retain actual source behavior.
  The node-gyp13.1.0 patch sends absolute Python.exe paths directly to execFile;
  relative/CMD discovery keeps its existing path. Actual Python invocation
  controls pass without changing machine settings.
- Full transcript review corrected an earlier premature clean-output statement:
  the successful rebuild still contained three Swift scanner shift warnings.
  Token32 was shifted through 32-bit constants, including Windows unsigned long.
  The real-scanner C regression fails before repair with native exit11. The
  versioned Swift0.7.1 patch uses UINT64_C(1) in the mask and runtime bit test.
  Shared sourceChunking12 retires derived meaning; existing Node pin stays.
  Fresh rebuild, real parser operation/reset and native regression acceptance
  are pending final verification below.
- Initial focused run:20 cases,14 passed,6 failed,0 timeouts/skips/native crashes.
  The original failure records remain intact. Repaired failures are rerun;
  earlier green observations do not establish a final-tree pass.
- The chunk-meta fixture exposed a real non-strict manifest read that bypassed
  the contained descriptor owner. Presence now requests contained bytes without
  relaxing metadata contracts; cache identity includes its containment context.
  Failed-close, cold/warm and seeded unscoped/stale-cache controls pass.
- Other fixture corrections preserve their actual contracts: separate original
  dictionaries for the old tokenizer oracle versus a fresh optimized plan;
  unchanged JSON omission of undefined filter properties; exact compiler-only
  partial boundary coverage alongside unsupported syntax coverage; explicit
  retained GraphQL preambles; the dependency-free information front door versus
  guarded workloads; structured ABI mismatch evidence; and Perl's required
  source-forced fallback outside the reviewed local helper hashes.
- The MCP1.9.0 contract snapshot was generated from its authoritative builder;
  the response snapshot was updated through the existing actual-server fixture,
  then passed in ordinary mode. A missing author launch-config path was removed
  only from controlled validation child environments; no user file was changed.
- Config budget rejected a private PowerShell transport field as an unknown
  setting. It is now encoded private child input, without a new public knob or
  allowlist relaxation. A real Windows PowerShell inspection of a filename with
  quotes/Unicode/command text verifies literal handling. The child selects its
  own built-in module path; inherited PowerShell7 modules cannot break the5.1
  signature inspector. Native errors retain the actual bounded child result.
- Environment governance found direct provider tooling-root access. It now uses
  the existing canonical environment owner; config budget and environment checks
  pass. No thresholds were raised.
- Generated-schema validation exposed unregistered standard date-time formats.
  Ajv now registers its standard format implementation, already installed via
  MCP and now declared directly. Valid reports pass; malformed dates, impossible
  dates, absent zones and unknown custom formats retain rejection coverage.
  This dependency declaration requires a fresh locked setup before final checks.

## Remaining acceptance

Discovery initially found3962 cases, partitioned into90 explicit cohorts:
3899 planned and63 exclusions (49 optional physical-link,7 platform,4 intentional
helper children,2 optional backends,1 opt-in representative workload). The new
Swift regression must be added by fresh discovery; source is not yet frozen for
cohort acceptance. Three retired legacy wrapper exclusions are no longer
physically discovered and are explicitly enumerated in the plan.

The uninstall case remains separate until the root confirms its disposable
fixture path. Its source previews every resolved target, requires containment
inside the fixture, verifies marked authorized roots, then deletes. It cannot
use an arbitrary author cache as authority.

Next: complete repaired locked bootstrap and fresh native/patch verification,
refresh generated surfaces, run required formatting and the complete front gate,
freeze the resulting clean candidate, and execute every explicit Windows cohort.
Case deadlines remain30 seconds, zero retries and native-status redo disabled.
Correctness concurrency is bounded; native lifecycle and all performance cases
run serially. Fix failures, preserve original assertions and receipt provenance,
then rerun affected checks against the resulting source. No current CPU/latency/
heap, full native lifecycle, real-model, optional-backend or release claim follows
from authored controls or earlier source counts.

## Front-gate repair batch, 2026-10-23

Fresh complete bootstrap and a separate final native/patch verifier now exit0:
37 required packages,33 language routes,8 patches/25 target files/60 hunks and
zero warning/error lines in their complete transcripts. The native Swift C case
passes after the original exit11 failure. The real grammar probe also parses
force-try and ordinary bang expressions across resets. Activation remains a
separate claim from full runtime lifecycle qualification.

The final focused batch passes26/26 with no failures/timeouts/skips/native crashes.
The first40-case gate passes34 and fails6. Actual fixes: remove the lock runtime
dependency from generic error diagnostics by moving the unchanged release helper
to its own owner; retain explicit undefined secondary causes; import the existing
verified contained SQLite reader; bind compatibility/embedding fixtures to their
owned index directories and supply the real fixture build generation. Actual
SQLite dense/stream/authority, storage-error and durable progress controls pass.
The repaired complete gate passes40/40. Formatting, config budget, environment
governance, generated freshness, command surface, workflow and diff checks pass.
The documentation guard now follows the current HTTP guide and deprecated
proposal provenance, and uses the canonical MCP version instead of stale1.4.1.

The live issue inventory is now963 with six newly reviewed P2 reports #1541–#1546;
they remain pending while the workers stay parked. Broad Windows correctness,
native lifecycle and serial performance cohorts have not yet established final
acceptance. Final source/commit mappings follow publication below.

## Published source and final discovery

The source/test repair tree is85be53744:63531ea9c contains scoped presence/cache
admission;740f67423 separates lock release from generic diagnostics and preserves
explicit undefined failures;33f0a1433 registers strict standard formats;dfa67a0af
repairs Swift bit32;04bb6aa3b fixes private Windows inspection input/module
authority and canonical provider environment;85be53744 repairs SQLite's actual
reader import and stale fixture authority/generation/coverage expectations.

Fresh actual discovery finds3963 cases, with3900 required/planned cases in90
explicit cohorts and63 enumerated exclusions. Native/lifecycle454 and all105
performance cases are serial. The remaining3340 correctness cases use bounded
concurrency; the single disposable uninstall case is separately audited before
execution. No discovered case is silently omitted. Final cohort source is frozen
only after the documentation/generated checkpoint is committed and pushed.

## First correctness cohort follow-through

The first two analysis cases fail at published2ae45984b without timeouts or
native crashes. Risk explain exposes a missing writeSemanticJson import, then
Windows promotion rejects its own generation because canonical lowercase paths
are compared case-sensitively. The original writer is imported; publication uses
platform path equality and retains original producer fallback generation identity.
Real index build/risk explain now passes, alongside copied-record, wrong root/
mode/index/schema/generation negatives and Windows case-alias positives.
Risk delta's EACCES fixture now targets the actual contained reader's openSync
boundary, retaining both original delta directions and positive-result controls;
it passes without weakening the error expectation.

A no-undef audit inspects2722 src/tools modules. Nine unbound references belong
to two missing helpers: document-symbol timeout classification and bakeoff elapsed
formatting; three browser Option references are legitimate. The helper owner
exports/imports are repaired, and normal lint now guards executable source owners
while leaving deliberately unresolved fixture source outside that rule. Restored
LSP failure/fallback production advances lspBindings41 to retire stale meaning.
The bakeoff resume fixture retains its positive assertion with an actual published
fixture generation and adds missing/newly appearing generation negatives; it
passes. No real model or latency benchmark was executed. Subsequent cohorts remain
pending, and source changes require their resulting-candidate checks.

First-cohort source checkpoint: `fdcfc0dcad41bdc70946a856dceb117f2b98bd77`. The source repairs and permanent
identifier guard pass required formatting, the complete front gate and40 gate
cases again. The analysis, publication/LSP and serial bakeoff controls pass;
full cohort acceptance is still pending. Freeze and rerun the original failed
analysis cohort against the next published checkpoint before proceeding.
