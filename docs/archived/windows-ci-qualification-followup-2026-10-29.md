# Stable-runtime CI qualification follow-up

This batch repairs the next CI failures at `ac69aa559384ba38258b18f82a75035aa335dbdb`.
Its [machine receipt](windows-ci-qualification-followup-2026-10-29.json) retains
source hashes, focused outcomes, setup and publication checks. Author-workspace
`.tmp/` paths are historical observations, not clean-checkout prerequisites.

## Demonstrated failures and repairs

- All three required Csharp installations succeed and the real 0.28.0 servers
  complete initialize, shutdown and natural exit with the selected .NET SDK
  10.0.403. Qualification rejects only their normal single-digit-hour info
  headers (`6:32:00.228`). The corrected check accepts valid one/two-digit hours
  while retaining provider/category, severity, minute/second and millisecond
  constraints. A new real-process simulated protocol control fails before repair;
  all 17 protocol/authority cases pass afterward, including warning, malformed
  time, untrusted command/workspace, timeout and shutdown negatives.
- macOS Go qualification selects an older cached gopls executable built by Go
  1.27.1 after successfully provisioning the intended Go 1.27.3 build. Provisioning
  now publishes a fresh canonical tooling/bin root. Every platform selects that
  exact root and compares actual command path and SHA-256 against its provisioning
  receipt. Product allocation admission and command trust are unchanged.
- Windows physical-link authority advances through 15 cases, including the
  previously failing artifact promotion. Its next failure is an unchanged source
  assertion finding `Command::new("node")` inside a Rust test-only module. The
  complete `redraw_tests` module moves to its own `#[cfg(test)]` file. Token
  equivalence and all 16 original tests pass; production-launch assertions remain
  unchanged. Two existing recovery test initializers are also corrected after
  strict Clippy across all targets reports their default-field assignments.
- A real macOS linker warning reports Tree-sitter's static runtime built for
  macOS 13.5 but its binding linked for 11.0. The binding's upstream 10.9 setting
  overrides Node 26's 13.5 floor and is clamped to 11.0 on ARM. The patch now uses
  Node's existing 13.5 floor. Its reviewed build-graph digest and complete
  nine-file patch roundtrip are updated together. Hosted linking remains the
  final execution proof; no warning suppression was added.

## Candidate-specific evidence

At `ac69aa559`, hosted policy, gate, Rust and **all three native-inspection jobs
pass**. Windows passes 32 real-terminal/artifact/index cases, 12 PTY disposal
controls, 19 parser/patch cases and four typed-index producer cases. The earlier
three Windows artifact witnesses now pass with their original UI actions and
deadlines. This observation does not prove a native product defect caused the
earlier timeouts. Linux/macOS native jobs retain their own hosted identities;
no WSL or local Linux execution was used.

The repaired candidate has a fresh locked Windows bootstrap on Node 26.13.0:
37 required packages, 33 activated language routes, seven patches, 25 target
files and 59 hunks verified. The upstream `prebuild-install@7.1.3` deprecation
remains explicit; native compilation/verification reports no errors. Protocol,
provisioning, patch and Rust controls pass with zero retries and unchanged bounds.
The publication gate and exact source hashes are retained in the machine receipt.

The next hosted candidate must qualify the repaired startup assertions, original
43-case Windows physical-link cohort, macOS link and downstream integration lanes.
This is not a full-suite or release pass. Three P1 acceptances and 25 historical
observed failures retain their roadmap owners. No public CLI, configuration,
artifact format, authority rule or runtime deadline changed.
