# Installable VSIX acceptance and CI follow-up

October 29, 2026; implementation `264d0d854`, based on `0cdb25a64`. The adjacent
[receipt](vscode-native-closeout-2026-10-29.json) retains source hashes, package
identity, native observations, original failures and focused checks.
Author-workspace `.tmp/` and `.testLogs/` paths are historical; embedded evidence
does not promise those directories in clean checkouts.

## #1288: actual package installation

The exact VSIX installs in an isolated official **VS Code 1.144.0** profile. The
Microsoft executable signature and archive SHA256 match the
[official stable metadata](https://update.code.visualstudio.com/api/update/win32-x64-archive/stable/latest).
Two independent builds produce identical VSIX bytes:
`b527771bdd3c6ed01712a03563b890575e3b9e39a6c5f04911a72f61b31bdaf2`.
Container qualification checks both root metadata files, identity/version/engine,
assets, entry point and **32 runtime modules**; existing missing/contradictory
metadata and unsafe-content negatives remain.

The installed package activates and registers **54 commands**. Its public
selection-search command retrieves `needle.js` through a separately installed
CLI using external **Node 26.13.0**, rather than the editor's bundled Node
24.22.1. Read-only observation uses the already loaded installed entry point;
the fixture never loads a checkout copy or replaces the VS Code API.

The separate CLI comes from the recorded npm source archive, with the exact
candidate lockfile and checked-in npm policy supplied as installation metadata.
Its full locked bootstrap builds/verifies required natives and all seven
patches, then writes readiness through the ordinary owner. Python **3.15.2**,
Node 26.13.0 and Windows x64/ABI 147 are recorded. The initial standalone setup
without the archive-omitted npm policy fails and is retained. The final bootstrap
exits zero; upstream `prebuild-install@7.1.3` deprecation remains visible.

Both actual editor sessions run on private Windows desktops and exit naturally,
with confirmed descendant and desktop-handle settlement and no input-desktop
windows. The first observes the external CLI child. Official uninstall removes
profile registration; a second fresh host proves the extension is absent and
all **54 commands** are unavailable. The editor may retain cached payload files;
profile removal and fresh-host absence are the asserted uninstall outcomes.
The complete two-host fixture passes in **16.3 seconds**, inside its unchanged
30-second outer bound. Each host retains its 18-second lifetime bound.

The profile disables updates/telemetry and unrelated built-in AI features through
the [supported setting](https://code.visualstudio.com/docs/supporting/faq), and
uses a one-file JavaScript project boundary. Vendor diagnostic logs remain in
the receipt. #630 retains broader editor/provider/platform and release acceptance.
The release archive verifier continues to require actual host evidence; archive
readability alone still cannot report install success.

## CI repairs

- Release readiness now retains the exact path of a structurally valid failed
  TUI report independently of its failure to qualify as passing release evidence.
  The portable duplicate/failure scenario moves out of the physical-authority
  wrapper, retaining every assertion. It fails before repair and passes afterward.
  Shape, source identity, role, duplicate and positive readiness gates stay strict.
- The Windows authority runner attempts every isolated selected fixture after a
  failure instead of stopping early. Its exact inventory, one-job execution,
  30-second bounds, zero retries/native redo and all-passing acceptance remain.
- POSIX terminal setup waits for the canonical validation seed before starting
  the native application's 18-second clock, matching Windows. Hosted phase
  evidence records 9.75 seconds of seed setup inside the former clock. Windows
  checks Python syntax only; actual POSIX acceptance remains hosted.
- The XML budget fixture uses the existing source-section oracle. It verifies
  complete preamble/section/suffix coverage before comparing the unchanged child
  section names. Cold/warm imports and all production **30 ms** bounds remain.
  The earlier expectation omitted the already implemented container preamble.

Nine affected package/archive/XML/release checks pass; the authority-runner
contract separately passes. The XML control also passes alone with all six raw
cold/warm samples retained. All eight publication checks pass, including
**40/40 gate fixtures**, with no failures, timeouts or skips. Runtime/test source
bytes remain unchanged through the gate and match the committed implementation.

Hosted Windows at `0cdb25a64` still has a validate/search timeout and workspace
capture failure. Seeds take 16.7/11.3 seconds; workspace records a successful
native exit and restored terminal before capture expiry and `AttachConsole`
diagnostics. Original logs, phase receipts and artifact hashes remain available.
Neither the 26-second capture nor 30-second fixture bound is increased. Final CI,
those Windows timing/lifetime problems, historical indexing hangs and P1 #1574
custom-backend deletion qualification remain open. Both historical indexing
hangs recur in that hosted run on Python 3.15.2; their cause remains unproven.

Automatic approval review rejected deletion of the completed disposable npm
diagnostic installation as **blocked by policy**. It remains in `.tmp/`; no
alternate deletion route was attempted. Earlier rejected Sublime-copy cleanup
is retained in its [own receipt](sublime-native-closeout-2026-10-29.md).
