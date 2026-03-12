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

## Operational workflows

Long-running workflows stream into the `PairOfCleats` output channel.

- `Index Build` runs an indexed build against the active repo context.
- `Start Index Watch` starts watch mode and leaves it running until `Stop Index Watch`.
- `Start Service API` and `Start Service Indexer` launch the local service commands and keep session status visible in the extension workflow status surface.

## Configuration

The extension honors the `pairofcleats.*` VS Code settings documented in:

- `docs/guides/editor-integration.md`

For the CLI contract and packaging behavior, see:

- `docs/tooling/editor-config-contract.json`
- `docs/specs/editor-packaging-determinism.md`
