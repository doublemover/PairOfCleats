# Native command dispositions

The native operator catalog composes the canonical public registry and option
owners. Every selected stable/operator/experimental command must have a concrete
typed form or an explicit reason its native request/review adapter is unavailable.
There is no generic unsupported fallback: missing dispositions remain errors.
Experimental commands require explicit catalog opt-in; default discovery and
preview cannot implicitly enable them. Opt-in still does not grant a launch
token for an unavailable native adapter.

Repository query and answer CLIs are available through their canonical typed
request owners. Their native request/cursor/revision pickers are unavailable;
those commands have explicit empty-form dispositions. Previously the missing
query entry threw during discovery and prevented unrelated native index, stats,
snapshot and workspace jobs from starting with `ERR_TUI_COMMAND_COVERAGE`.

The lightweight `tui/operator-command-dispositions` gate checks every registry
entry with experimental commands and backend delegation both enabled/disabled,
without launching a native binary or selecting a repository. Existing operator
and native workflow fixtures retain their real positive assertions and exact
request, scope and one-use confirmation contracts. The new gate and repaired
native fixtures remain locally unrun until the implementation batch is complete.
