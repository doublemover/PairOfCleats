# PairOfCleats

<p align="center">
  <img src="./clete.png" alt="PairOfCleats logo" width="96" />
</p>

**Find code, follow its connections, and bring the right context to your next change.**

PairOfCleats builds a local index of source code, documentation and structured
records. Search returns relevant code with locations and metadata; relationship
analysis helps you follow imports and calls, explore the impact of a change and
gather focused context for another tool.

Use it when you want to:
- Find a definition or implementation without guessing which file contains it
- Narrow a search by path, language or symbol metadata
- Follow connected code before changing a shared function or interface
- Identify potentially affected code and tests
- Search a project spread across several repositories

For example, a result points you to the function and its location rather than
just leaving you with a matching filename:

```text
1. renderSearchOutput
  src/retrieval/cli/render.js:[20-60]                     3/28/26 7:00AM
  renderSearchOutput(options)
```

*Example captured from a tiny checked-in output fixture with the current formatter;
location/date metadata is illustrative.*

From a useful match, you can follow related code, inspect why it ranked, or
collect a bounded context pack. The CLI, editors and services all build on the
same local index.

## Quickstart

The current install path is a source checkout with **Node.js 24.15.0 or newer**
and npm. Native dependencies may require a C/C++ toolchain and Python 3 when
compatible prebuilt binaries are unavailable.

```sh
git clone https://github.com/doublemover/PairOfCleats.git
cd PairOfCleats
npm ci --include=dev
```

Development dependencies are needed to apply the checkout's required patches.
The examples run the CLI directly, so you do not need a global command install.

For a first sparse-search build, merge this into the target project's
`.pairofcleats.json`; embedding models and automatic tool installation stay optional:

```json
{
  "indexing": { "embeddings": { "enabled": false, "mode": "off" } },
  "tooling": { "autoInstallOnDetect": false, "autoEnableOnDetect": false }
}
```

Replace `"path/to/your-project"` below with the repository you want to search.
Run from the PairOfCleats checkout:

```sh
node bin/pairofcleats.js index build --repo "path/to/your-project" --mode code --threads 1 --no-sqlite
node bin/pairofcleats.js search --repo "path/to/your-project" --mode code --backend memory --top 5 -- "cache"
```

Use a word or symbol from your project. For a more selective search, add
`--path src`, a language filter or a quoted phrase. Use `--json --compact` for
structured results and `--explain` to inspect ranking.

The [first-search guide](docs/guides/first-search.md) covers configuration
validation, resource controls and documentation search. [Guided setup](docs/guides/setup.md)
is available when you want optional dictionaries, models, language tools or SQLite.

## Follow a result further

- **Impact analysis** explores code connected to a changed file or symbol.
- **Test suggestions** identify related tests worth reviewing.
- **Context packs** collect source excerpts and supporting relationships within
  explicit limits, so downstream tools receive focused context.
- **Code maps** make repository structure easier to explore and export.
- **Workspace search** combines indexes from several repositories.

See [code maps](docs/guides/code-maps.md), [workspace setup](docs/specs/workspace-config.md)
or `node bin/pairofcleats.js help` for the available workflows.

## What to expect

Language-aware analysis varies by format and tooling: syntax structure, types and
navigation are separate capabilities. The [language-support record](docs/guides/language-toolchain-acceptance.md)
explains current coverage and tested limits. Indexed relationships can miss dynamic
behavior, so impact and test suggestions are starting points for review.

Search works with local file-backed indexes. SQLite and other backends can add
retrieval options; embeddings require optional model setup. Build only the modes
you need: `code`, `prose`, `extracted-prose` or `records`. A larger repository
or richer analysis needs its own resource choices.

## Interfaces and documentation

The CLI is the simplest place to start. Other interfaces have separate setup or
build requirements:

- [VS Code and Sublime Text](docs/guides/editor-integration.md)
- [HTTP services](docs/guides/service-mode.md)
- [MCP](docs/guides/mcp.md)
- [Interactive TUI](docs/guides/tui.md)

For detail: [search behavior and output](docs/guides/search.md),
[commands](docs/guides/commands.md), [configuration](docs/config/contract.md),
[architecture](docs/guides/architecture.md) and
[optional backends](docs/guides/external-backends.md).

For coding agents and contributors, the single
[repository work guide](docs/agents.md) links instructions, source owners and
validation references.

The package is currently marked private; no license file is included in this checkout.
