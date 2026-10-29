# CI SDK delivery and Windows artifact-path follow-up

The follow-up passes **22/22 affected fixtures** with zero retries, timeouts,
skips or native-status redo. It repairs the next setup and authority failures
exposed by the hosted stable-version candidate. The
[machine receipt](windows-ci-integration-repairs-2026-10-29.json) retains source
hashes, original failures, actual Windows short-path inputs and all outcomes.
Author-workspace `.tmp/` paths are historical receipts, not clean-checkout inputs.
Implementation head: `db721830670951e404b4a9652a524755cb0b1072`.

## Hosted evidence and delivered repairs

Candidate `8a79cc7c901380fd8afaa64d235d19600cf21c41` passed hosted policy, gate
and Rust checks. Ubuntu's required Csharp launch could not find a command: the
best-effort product installer correctly refused its unqualified allocation
forecast. PHPactor had the same prerequisite. macOS found a cached Csharp binary,
but the handshake lacked an exact grant for the generated qualification workspace.
Windows authority advanced through reuse and validation, then rejected a manifest
using a valid `RUNNER~1` spelling of its physical index path.

- CI now provisions Csharp 0.28.0 into a fresh runner-temporary tooling root using
  its already-verified .NET SDK. It checks original SDK bytes/version, clears
  ambient NuGet sources in a private configuration, verifies the exact installed
  package/command version and hashes the resulting executable before publishing
  any environment/path changes. Runtime qualification selects this exact tooling
  root and compares its actual command identity with the provisioning receipt.
- Supported CI platforms install the approved PHPactor PHAR through the existing
  bounded installer, with its pinned checksum, zero download retries and exact
  shim verification. The selected PHP binary, version and required extensions
  are checked first. Runtime qualification again requires the exact provisioned
  command. The stock PHAR's Windows/POSIX limitation remains explicit.
- These CI-owned installations leave the product installers' allocation
  requirements intact. Real initialization, shutdown, process exit, SDK identity
  and unexpected-stderr checks remain separate mandatory steps. Simulated source
  controls do not qualify a vendor install or language-server session.
- CI explicitly grants its checkout and each selected fixture workspace using
  JSON-safe launch expressions. The product's trust policy and handshake remain
  unchanged. A new negative control proves repository trust alone cannot grant
  a separately selected qualification workspace; untrusted-command rejection
  still prevents even the version probe.

## Windows path authority

The old lexical-only artifact boundary rejects a real file when its root and
target use different Windows namespace spellings. The corrected regression fails
against the original source and passes after repair. An earlier syntax-error
attempt is preserved separately and is not defect evidence.

Ordinary paths retain their existing fast checks. Windows alias admission checks
every original component for reparse points, resolves existing physical ancestry,
and requires the target to remain strictly inside the physical index root. A
missing interior file retains its normal missing-file error; missing foreign
targets retain boundary rejection. Manifest labels remain relative lexical
identities, with unchanged absolute/traversal rejection.

A real `GetShortPathNameW` control produced distinct `DEVELO~1`, `PAIROF~1` and
short manifest spellings without creating links or changing system settings.
Both long-root/short-file and short-root/long-file reads return the original
artifact. Verbatim paths, missing paths, foreign roots and a controlled original
reparse component are covered. Existing traversal and publication-identity
controls pass. The original physical-link cohort remains a hosted qualification.

The subsequent `475a75b6a` run passes policy, gate, Rust and both Linux/macOS native
jobs. Windows native inspection passes 29/32; three artifact-action cases fail
their existing 14-second UI/inventory witnesses. All three pass unchanged in the
local focused recheck, so their hosted cause remains unproved. The artifact
observer now consumes each terminal fragment once instead of reparsing retained
output at every poll. Its original UI-driven inputs and deadlines remain intact.
Bounded failure screens, lifecycle/PID observations and binary identities are
retained and uploaded so a repeated failure can be attributed. This is an observer
repair and diagnostic improvement, not claimed closure of the hosted failures.

## Validation and remaining work

The 22-case group covers 13 protocol lifecycle/authority cases, two provisioning
fixtures with their internal negative modes, six artifact path/traversal controls
and publication identity. Every fixture uses a 30-second deadline; the slowest is
the intentional unresponsive-shutdown control at 7.2 seconds. All eight publication
checks pass, including 40 gate cases. Publication checks and exact source identity are retained
in the machine receipt. The artifact workflow cases and differential terminal
renderer have separate focused results. Hosted execution of the new delivery paths remains
pending; no full-suite or release pass is claimed.

Sublime #1289 is separately closed with its complete Windows native acceptance.
The three remaining P1s, the historical 25 observed failures and broader platform,
model, optional-backend and release qualification retain their existing owners.
