# PairOfCleats for VS Code

PairOfCleats brings local repository search and operational workflows into VS Code.

## Core commands

- `PairOfCleats: Search`
- `PairOfCleats: Search Selection`
- `PairOfCleats: Search Symbol Under Cursor`
- `PairOfCleats: Repeat Last Search`
- `PairOfCleats: Explain Search`
- `PairOfCleats: Index Build`
- `PairOfCleats: Start Index Watch`
- `PairOfCleats: Index Validate`
- `PairOfCleats: Start Service API`
- `PairOfCleats: Start Service Indexer`
- `PairOfCleats: Tooling Doctor`
- `PairOfCleats: Config Dump`
- `PairOfCleats: Index Health`

## Results explorer

Saved searches populate the `PairOfCleats Results` explorer view. From there you can:

- reopen previous searches
- rerun saved result sets
- open individual hits
- reveal hit files in the explorer
- copy hit paths

Search History reopens the stored hits, repository identity and recorded evidence
without contacting the CLI or API. Repeat Last Search and Rerun Result Set are
explicit refresh actions that create a new result set. Saved evidence does not
establish the current worktree or index state.

Search output retains the producer's actual backend, fallback fidelity, empty
result reasons and recorded generation identity. Older history without those
facts is labelled unknown. Empty results offer deliberate Index Health/Tooling
Doctor actions when the recorded reason supports them; receiving diagnostics
never launches either workflow. See the [diagnostic contract](../../docs/contracts/search-diagnostics.md).

## Operational workflows

Long-running workflows stream into the `PairOfCleats` output channel.

Search, operators, navigation, inline requests and managed services belong to
the extension host. New foreground searches cancel superseded owned work;
late replies cannot replace current results. Deactivation cancels and waits for
owned resources with a bounded deadline. An unconfirmed process-tree shutdown
is reported as such. Windows teardown uses the current user's process ownership
and does not request elevation.

Inline context currently describes an indexed file summary. A word spelling is
not treated as a canonical symbol identity, aggregate warnings are not precise
source findings, and dirty buffers are labelled as differing from indexed text.
Source edits, settings and workspace changes invalidate publication authority.
Cross-request payload reuse requires authoritative index-generation identity;
without that identity the extension requests fresh context instead of using TTL
as evidence of freshness. Editor-host lifecycle qualification remains separate
from the authored fixture coverage.

- `Setup`, `Bootstrap`, `Tooling Doctor`, `Config Dump`, and `Index Health` emit structured summaries with explicit next actions.
- `Index Build` runs an indexed build against the active repo context.
- `Start Index Watch` starts watch mode and leaves it running until `Stop Index Watch`.
- `Start Service API` and `Start Service Indexer` launch the local service commands and keep session status visible in the extension workflow status surface.

## Configuration

Checkout JS commands require an external Node.js >=26.12.1 <27, independently
of VS Code's embedded runtime. Set `pairofcleats.nodePath` to an absolute Node
executable in User Settings, or leave it empty to use `node` from the editor
process PATH. Workspace overrides and workspace environment values cannot select
this runtime. Both configured JS CLI entrypoints and operator scripts use the
same bounded version/identity check; an incompatible runtime fails with setup
guidance. Executable CLI commands retain their own invocation behavior.

The extension honors the `pairofcleats.*` VS Code settings documented in:

- `docs/guides/editor-integration.md`

API response bodies have the same 20 MiB byte ceiling as CLI capture. Both
successful and error bodies are counted while streaming; oversized responses
are cancelled and reported as `api-response-too-large`. Reduce the result scope
or volume before retrying. Retained HTTP error previews contain at most 4,096 characters.

For the CLI contract and packaging behavior, see:

- `src/contracts/editor-config-contract.json` (bundled with each editor package)
- `docs/specs/editor-packaging-determinism.md`

Risk Explain resolves chunk, file and symbol seeds through the canonical context-pack
code-generation owner. Editor requests and exported results retain repository, mode,
concrete index directory and index signature. Stale repo-local index-code artifacts
do not provide a fallback. Saved qualified requests remain pinned; if that generation
or chunk is unavailable, run the current command deliberately to choose current evidence.
