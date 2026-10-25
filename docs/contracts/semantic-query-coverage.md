# Semantic query coverage qualification

Find, detail and trace evaluate required phase presence for each selected
coverage lookup. A lookup is source-related: the store returns available rows
from the selected partition and sibling physical partitions for that source.
Syntax and analysis need not live in the same physical partition. Both phase
classes must be present and every present row must be complete. Complete rows
for one source cannot fill another source's missing phase.

Returned coverage arrays remain page-local, retaining the physical `partitionId`
on each row. `coverage.response` describes page enumeration, independently of
analysis qualification. A response can enumerate all selected records while
remaining partial because a source has missing, partial, deferred, disabled,
unsupported, failed or stale coverage. Exhausting a selector without any selected
coverage scope remains partial; it is not proof that behavior is absent.

Overall status qualifies the drained request. Continuations retain five bounded
booleans: whether any scope was observed, missing syntax/analysis and incomplete
syntax/analysis. These facts accumulate monotonically across pages, without
retaining raw rows or an unbounded list of source IDs. Warnings distinguish
missing phases from explicitly incomplete phases; the raw page rows preserve
precise phase states and reasons. Detail also retains an incomplete-evidence flag
so a later page cannot erase an earlier missing requested record or partial
provider-evidence delivery. Existing generation, selector and cursor binding and
response byte/work limits still apply.

The mixed-source regression uses real artifact and SQLite stores with distinct
sources and sibling analysis partitions. It covers both detail orders, one/two
page requests, missing phases, partial/deferred/unsupported rows, positive
controls, empty discovery, missing-record frontiers and monotonic qualification.
Fixtures are authored; Windows execution remains deferred.
