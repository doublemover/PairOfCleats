# Documentation

Start in the PairOfCleats application checkout. Select the repository to index
with `--repo`; installing this application and preparing a target are separate jobs.

| Task | Start here | Reference owner |
| --- | --- | --- |
| Install and get a first result | [Setup](guides/setup.md), [first search](guides/first-search.md) | [Runtime](guides/node-runtime.md), [native prerequisites](guides/bootstrap-prerequisites.md) |
| Understand a configuration | [Configure a target](guides/configuration.md) | [Schema](config/schema.json), [surface governance](config/surface-directives.md) |
| Search and interpret results | [Search](guides/search.md) | [Generated command inventory](guides/commands.md) |
| Search two repositories | [Workspaces](guides/workspaces.md) | [Workspace membership](specs/workspace-config.md), [federation](specs/federated-search.md) |
| Inspect relationships and context | [Graph commands](contracts/graph-tools-cli.md) | [Context and risk](contracts/context-pack-risk-contract.md) |
| Choose storage and semantic retrieval | [Backends](guides/external-backends.md), [embeddings](guides/embeddings.md) | [Artifacts](contracts/public-artifact-surface.md) |
| Use a service or coding agent | [HTTP API](api/server.md), [MCP](guides/mcp.md) | [Queue-backed indexer](guides/service-mode.md), [API/MCP contract](contracts/mcp-api.md) |
| Use an editor or viewer | [TUI](guides/tui.md), [code maps](guides/code-maps.md) | [VS Code](../extensions/vscode/README.md), [Sublime](../sublime/PairOfCleats/README.md) |
| Maintain or update an installation | [Source upgrades](guides/upgrades.md), [setup diagnosis](guides/setup.md#diagnose-readiness) | [Storage](contracts/storage-layout.md), [runtime](guides/node-runtime.md) |
| Contribute or qualify a change | [Contributor workflow](guides/contributing.md), [language onboarding](guides/usr-new-language-onboarding.md) | [Test runner](testing/test-runner-interface.md), [benchmarks](benchmarks/overview.md) |
| Check language coverage | [Language capabilities](guides/language-capabilities.md) | [Language registry](../src/index/language-registry/registry-data.js), [provider registry](../src/index/tooling/providers/index.js) |

`docs/roadmap.md` remains the sole active status and execution-order owner.
Source under `src/contracts/`, validators, the configuration schema and command
owners determine accepted behavior. Generated inventories are references; edit
their registered generators through [generated surfaces](tooling/generated-surfaces.json).

Specifications may contain proposals as well as current contracts; read their
status and replacement notices. [Archived documents](archived/README.md), dated
qualification guides, audit worklogs and author-workspace `.tmp`/`.testLogs`
receipts are historical evidence with their original runtime, platform and head.
They are not clean-checkout inputs or current release qualification.
[Dependency research](dependency_references/readme.md) is background research,
not a statement of installed dependencies, shipped integrations or current package
recommendations. Check `package.json`, the lockfile and the consuming source.
