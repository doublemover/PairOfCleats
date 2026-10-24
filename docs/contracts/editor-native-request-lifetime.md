# Editor native request lifetime

VS Code definitions and references capture the requesting document version,
local file URI, saved/closed state, cursor and declaration policy before awaiting
repository selection. Repository lookup cannot replace the buffer which admitted
the spelling query. The original cursor and policy remain immutable throughout
CLI dispatch and result handling.

Saved-source arguments establish the first qualified source hash and coordinates
under the selected repository. Later admission must reproduce that request's
arguments and repository. After the CLI returns, every target still uses the
existing opened-document byte, URI, buffer/version and final-publication checks.
Opening targets introduces further awaits: before returning native locations,
the provider checks the original requesting document and saved source again.
A changed/dirty/closed source, changed local URI or replaced saved bytes discards
those locations even when all target documents remain unchanged.

Completion and document-symbol providers also retain their original requesting
document version/URI/state across repository lookup and CLI execution. Their
indexed definition/reference candidates retain their existing evidence semantics;
this lifetime fence alone does not promote spelling candidates to unique bindings.
The later #1543 producer/consumer repair qualifies native document symbols with
canonical source/declaration/range witnesses, generation and source hash before
publishing Outline ranges. Dirty, changed, missing or unlocated witnesses remain
outside native Outline; Inspect Indexed Document Symbols retains approximate
indexed evidence explicitly. No synthetic origin range stands in for missing
source coordinates. Existing cancellation and child ownership remain with
the extension operation owner.

The explicit VS Code indexed-definition/reference picker also retains that exact
provider request with every native location. Its choices must be original items
from that picker and keep the original active source/cursor through selection
admission. Later target opening and display continue to check the original
source version/URI/bytes. A new explicit indexed picker revokes the previous
picker through the existing operation owner. An empty/failed new request cannot
borrow candidates from another request's latest global evidence. Ambiguous
choices retain their original candidate spans and remain explicitly ambiguous.
Before applying exact ranges, displayed editors must identify the same qualified
opened document and version; a matching source witness cannot authorize a
different editor's selection.

Sublime indexed navigation also records the original source view and buffer IDs,
window, filename, change count and cursor. An equal-text/equal-version sibling
view cannot replace that source when the response arrives or when cursor binding
is reused. A resolved native result picker checks the original cursor/source
again before opening; source view closure, movement between windows, rename,
edits, context supersession and saved-byte replacement invalidate its request.
The original source version/file/buffer check continues through deferred target
loading before any target annotations or precise selection are changed.
Opening the intended target may change focus, and selecting a target in the
original source view may move its cursor deliberately; those actions do not
require the old cursor after selection admission. Ambiguous candidate inspection
retains its separate evidence semantics and checks source admission before the
candidate choice.

The original additional request-fence controls were authored without execution.
The later #1543 actual collector/query/provider fixture passes on Windows Node26
with an inert registered editor host; scoped formatting also passes. These narrow
observations do not qualify a real VS Code or Sublime host. The rest of this
implementation wave retains deferred runtime and integration acceptance. File reads provide observed
consistency, not an atomic filesystem snapshot. This source work does not establish generated
source mapping, complete semantic producer coverage, host cancellation behavior,
native teardown, resource bounds or performance acceptance.
