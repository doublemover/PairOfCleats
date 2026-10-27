# Sublime native command registration — 2026-10-27

Source commit `e191d2402f8ebbb1f71bc50feaff58b698eaee2b`, tree
`1c74fb73f46e39b59aaf3e433c7245558a2ea5ab`, on
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Machine-readable observations: [receipt](sublime-native-registration-2026-10-27.json).

## Demonstrated defect and repair

The canonical packed archive loaded in an isolated actual Sublime Text build
4192 profile, resolved the bundled contract and ran in its default Python 3.3
environment, but registered zero PairOfCleats commands. Importing command child
modules was insufficient: the native loader discovers classes exposed by root
plugin modules. The last JavaScript log line was not used as attribution.

The root plugin now exposes the existing explicit command-module classes while
leaving registration and unloading to Sublime. Class identity and implementation
modules are retained; conflicting names are rejected, and refreshing exports
removes only aliases owned by the previous export set. The actual packed host
then registered 61 commands, including every advertised palette command, without
duplicates. This is native evidence of this repair, not completed host acceptance.

The new headless regression models root discovery and checks advertised commands,
exact class aliases, uniqueness and export refresh ownership. All **30** existing
and new headless Sublime fixtures passed with 30-second individual deadlines,
zero retries and native-status redo disabled. The **40-test gate lane** and every
other cheap pre-push check passed. Python sources also compiled. No dependencies,
pins, semantic producer versions or public configuration contracts changed.

## Native work still open

**#1289 remains open.** The final packed attempt did not produce its expected
native search result before the fixture deadline. Its host exit was nonzero;
search, update/reload, uninstall, unpacked and shadowing acceptance have not been
demonstrated. No failing assertion was removed or counted as passed. Earlier
harness failures include an invalid fixture configuration, full-index seed
deadlines and observing the wrong interpreter from a User package; their raw
receipts are retained. The final fixture uses canonical published index artifacts
and first proves both unchanged search queries through the real CLI. It makes no
full-index-build qualification claim.

Further native launches were stopped when the user reported visible windows.
Background launch flags do not guarantee invisible windows. The explicit native
owner now lives under `tests/fixtures/sublime/`, outside automatic discovery,
requires both a case and a host path, and documents that it opens windows. Its
remaining paths are unfinished qualification work. All test-owned editor and
plugin-host instances exited; the installed normal editor session was untouched.

Historical author-workspace evidence resides under
`.tmp/tasks/sublime-native-20261027/`, `.testLogs/`, and the logged disposable
`.tmp/dev/tests/cache/sublime-native-*` profiles. These are absent from clean
checkouts. The attempted deletion of copied native runtimes was rejected by
automatic approval review as “blocked by policy”; no deletion or alternative
route was attempted afterward. Runtime copies therefore remain in those profiles.

The native runtime behavior follows the publisher's
[API environment documentation](https://www.sublimetext.com/docs/api_environments.html)
and [command-line interface](https://www.sublimetext.com/docs/command_line.html).
