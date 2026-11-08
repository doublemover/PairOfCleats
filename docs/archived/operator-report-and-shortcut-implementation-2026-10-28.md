# Operator reports and opt-in editor shortcuts — 2026-10-28

Source implementation, **UNVALIDATED**. No editor host, project fixture, child
fixture or benchmark was executed. All issue acceptance remains pending. The
branch is `codex/pr557-audit-repairs-20261012`, Node 26.12.1, Windows x64.

| Issue | Source head / tree | Deliverable |
| --- | --- | --- |
| #216 | `20cc6cb92aebe7f1641934827c07780369239109` / `2d11e735ed1de04e3498b4f179a13a7d0e9ba2c4` | All four automatic Sublime keymaps are empty. The original five Windows/Linux/macOS chord suggestions ship as non-keymap JSON examples with User-keymap opt-in/opt-out instructions. Command palette and menu access remain. No new setting or custom editor context is needed. |
| #173 | `228e6ce38aba4eee617557fa8a1f4ba2d1465091` / `aad77158663d509b8635dbd2608368bc4da3e04a` | Diagnostics rejects unsupported/empty/no-op selections and missing required inputs before unrelated config/artifact work. Reports preserve actual risk availability status/code/reason and distinguish disabled, summary-only, healthy, capped, degraded, missing and failed output. Stale-job recovery retains the exact executable, script, service config, queue, job and working directory; the human renderer includes the concrete remediation list. A direct queue override inconsistent with its config yields an explicit reason and no executable recovery action. Valid warning/error reports retain successful report-only CLI exit status. |

The shortcut change preserves the original suggested inputs and all five
commands in each platform example. It removes automatic interception, which
contradicted the original opt-in requirement; it removes no command coverage.
The packaging fixture now inspects all platform variants in the actual universal
archive, requires every automatic keymap to be empty, and verifies all five
example commands/chords against the retained command palette.

Authored or strengthened acceptance, **not executed**:

- `tooling/sublime/package-release-sanity`: actual packaged keymap and example
  bytes, all three platforms, existing command/menu/settings/import assertions.
- `tooling/reports/diagnostics-report-selection/*`: 13 independently selectable
  controls for invalid/empty/mixed selections, missing inputs, validation order,
  duplicate selection, and actual CLI warning/error-report/request-error exits.
- `context-pack/risk-strict-status`: actual assembler-produced disabled,
  summary-only, healthy uncapped (zero and nonzero flows), capped, missing and
  invalid results, plus eight injected failures at original required artifact
  reads. Every result feeds the report and human renderer with exact
  availability/code/reason/strictness/degradation comparisons. Existing strict
  and schema/load negative assertions remain. The nonzero healthy control was
  added in the following documentation/coverage checkpoint.
- `tooling/reports/diagnostics-report-queue`: original real queue fixture plus
  exact config/queue/job action identity, actual bounded inspect command from
  another cwd, full human remediation, mismatch and direct-directory controls.
  The source fixture's inspect child uses `windowsHide: true`; no child ran now.

Format/ESLint, changed JavaScript syntax and whitespace checks passed at the
source checkpoints; static shared-module analysis found zero cycles. These are
not runtime, editor-host, packaging, latency or final-tree acceptance. No new
public CLI/config knob or policy-exit relaxation was introduced. Source commits
remain unpublished while the user-requested functional pass/front gate is
deferred. Current owner-queue counts become **478 pending, 144 partial,
96 unresolved** of the last 718-open inventory; neither issue is closed.
