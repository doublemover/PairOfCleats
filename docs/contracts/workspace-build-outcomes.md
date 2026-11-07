# Workspace build invocation outcomes

Status: UNVALIDATED source and authored controls, 2026-10-22.

Workspace build JSON diagnostics retain total, failed and entries as attempted
build outcomes for existing consumers. Additional configured, selected,
attempted, passed, skippedAfterFailure and excludedDisabled counts distinguish
this invocation's selection from a refreshed workspace manifest. Each selected
repository appears exactly once across entries and skipped. Disabled exclusions
appear separately in excluded. Lists retain stable repository-ID ordering and
canonical roots captured before build callbacks; later configuration mutation
cannot change the report. The compatibility runWorkspaceBuild helper still
returns only attempted entries.

Strict failure stops new scheduling, waits for already claimed builds and marks
only unstarted selected repositories skipped with reason strict-failure. Those
entries contain no invented exit status or duration. A build callback without an
outcome is a failure rather than an omitted attempted repository. Disabled
repositories have reason disabled; include-disabled selects them normally.
Outcome is passed, failed or no-work. A no-work invocation keeps its historical
successful exit while explicitly indicating that no repository build occurred.

Manifest refresh remains separate and may retain older valid generations for
repositories unbuilt in this invocation. A refreshed manifest never means those
repositories were rebuilt. No new scheduling/configuration knob or manifest
format relaxation is introduced. The existing fixture adds actual serial,
controlled parallel completion, mutable inventory, disabled/empty, continuation
and missing-outcome assertions without launching children. None has executed;
real child/manifest/Windows/full-suite acceptance remains outstanding.
