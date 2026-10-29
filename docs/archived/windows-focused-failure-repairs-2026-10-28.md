# Focused Windows failure repairs

At `f8dc966bb7e57db82308872be8eb92b49ad74ee4`, **26/26 focused cases pass**:
nine original failures from checkpoint 305 and 17 direct regression controls.
There are no failures, timeouts or skips. Each fixture used one job, one indexing
thread, a 30-second deadline, zero retries and native-status redo disabled.
The [receipt](windows-focused-failure-repairs-2026-10-28.json) retains every
outcome, original failing report hashes, source identities and publication checks.

- **Astro source spans:** nested compiler expression ranges could extend beyond
  their containing element and the original file, causing strict VFS admission
  to reject the entire file. An admitted outer node now owns the template extent.
  UTF-8 compiler offsets convert to UTF-16 with sparse bounded checkpoints;
  incomplete code-point boundaries remain inadmissible. The existing Unicode/CRLF
  fixture now checks exact script/template slices, long non-ASCII frontmatter and
  strict admission of every produced chunk. Svelte, Vue and Astro import positives,
  framework determinism and the segment pipeline pass. `sourceChunking41` prevents
  replay of the previous meaning.
- **Scheduler degradation:** explicit null chunking context now uses the same
  empty context as an omitted argument. The scheduler fixture supplies canonical
  embedded segment type/identity so JSON checkpoints retain its complete input.
  Exact chunk comparisons and scoped degradation controls remain.
- **Canonical fixture inputs:** comment receipts use their shared version;
  checkpoint expectations include source-admission refresh; dictionary failures
  require the original error identity anywhere in its retained error graph.
  The provider merge negative uses an admitted edge kind, reaching cross-group
  rejection rather than failing earlier schema admission. Drain publication uses
  the supported thread setting for its operational-policy mutation. Literal
  metadata uses each declaration's actual source range, retaining both parser
  families, scalar precision, inference, writer validation and negative controls.
- **Windows spool lifetime:** Windows refuses renaming an open directory. The
  existing stat gate now injects a different pathname identity through the actual
  cleanup owner. The case proves refusal, directory preservation, exact once-only
  native closes and successful recovery after identity restoration. Capable POSIX
  launches retain real rename/substitution coverage; this Windows result does not
  claim that filesystem operation passed. All 15 spool lifetime cases pass.

All eight publication checks pass, including format, configuration/environment
budgets, generated freshness, command/workflow contracts, **40/40 gate cases** and
diff whitespace. These bounded checks are separate from a full suite rerun.
No public contract or assertion was relaxed, fixture removed, deadline extended
or crash retried into passing evidence.

The [partial campaign](windows-partial-validation-checkpoint-305-2026-10-28.md)
retains its original 46 failures, including five timeouts, and 3,450 unrun IDs.
Nine of those failures now have passing focused rechecks; the remaining 37 need
repair or qualification. This is not a full-suite pass or a new native crash
attribution. Further validation follows the user's focused-recheck instruction.
Raw `.tmp/` paths are historical author-workspace locations.
