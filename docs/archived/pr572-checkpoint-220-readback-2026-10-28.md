# PR572 checkpoint 220 readback and recovery — 2026-10-28

PR572 body updated at **2026-10-28T17:59:48Z** and read back byte-for-byte:
25,079 characters, reduced from 64,661. Title remains
`Repair runtime, correctness, tooling and qualification gaps`; base `main`, head
`codex/pr557-audit-repairs-20261012`, published head
`adbcaf777ce91642bb0a60de892171d8c3a529f7` are unchanged. The PR is attached
to this task. This publishes metadata, not the local source commits.

The body now leads with concrete deliverables, recorded work reductions and
source-bound validation. The collapsed implementation section includes the latest
SQLite count/identity/compaction/vector repairs, actual optional CDB source,
forensic ordering/drain and owned child progress. It explicitly records 206 new
unrun controls since checkpoint 200 and local checkpoint
`54fe6d0b120b307f735ab2db7f8d75ae466a39c1`.

Fresh issue inventory: all 718 open reports appear exactly once in the collapsed
current-status groups, 482 pending / 146 partial / 90 unresolved. Number groups
replace repeated long issue-title rows; full mappings stay in the owner queue.
All 154 historical qualified closing references are preserved exactly and none
is currently open. No issue was closed in this wave.

Historical author-workspace recovery artifact (ignored; not a clean-checkout
deliverable): `.tmp/tasks/git-ref-recovery-20261027/7abea07528a040e09e667e598424d6fb/native-crash-and-sqlite-correspondence-through220.bundle`.
It contains branch head `54fe6d0b120b307f735ab2db7f8d75ae466a39c1`, requires
checkpoint-200 base `49adae4c14d3052647b5d495e139f73f7a5e0445`, and passes
`git bundle verify`. Length **110,064 bytes**; SHA256
`eeb3334b6f23113277720fd0f743e554697c64d2e51f0a5a77ce6b6b3258adbc`.
The absolute target/parent were verified within the workspace and no existing
bundle was overwritten. An initial parent-path check rejected unsupported
PowerShell parameter combination before any bundle write; corrected path
validation and both Git bundle operations completed successfully.

Package and lockfile SHA256 remain exactly equal to the recorded clean locked
bootstrap inputs. No setup/native rebuild or functional check ran. No source push,
merge, CI acceptance claim, debugger/child/native/model/install campaign, WSL,
subagent, worktree, physical symlink or privilege change occurred. Implementation
continues; current-source qualification/publication gate remains deferred.
