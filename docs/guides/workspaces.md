# Search two repositories

Prepare the application checkout once, then build a small code index for each
selected target using [first search](first-search.md). Application installation,
workspace membership and each repository's `.pairofcleats.json` are separate.

## Preview membership and create explicitly

Select only the roots you intend to search. The authoring command resolves
physical identities through the existing workspace validator and detects duplicate
roots/aliases. It does not scan neighboring directories, build indexes, provision
tools or grant trust.

<!-- poc:recipe workspace-preview shell=portable effects=read-only targets=multiple -->
```sh
node tools/workspace/author.js --operation init --workspace "path/to/workspace.jsonc" --repo "path/to/project-one" --repo "path/to/project-two" --alias one --alias two --json
```

Repeat with `--apply` only after reviewing the canonical roots and serialized
paths. `init` refuses an existing file; `--operation add` preserves existing
settings and previews its membership-array formatting rewrite. Use
`--operation validate --workspace ...` for read-only contract validation.
The resulting minimal membership shape is:

```jsonc
{
  "schemaVersion": 1,
  "repos": [
    { "root": "./project-one", "alias": "one", "enabled": true, "tags": ["service"] },
    { "root": "./project-two", "alias": "two", "enabled": true }
  ]
}
```

Relative roots are based on the workspace file's directory. Real paths, worktrees
and symlink aliases follow [workspace identity](../specs/workspace-config.md);
identity is local/path-based, not a cross-machine portable repository identity.
Optional workspace `cacheRoot` places federation data and does not retarget each
repository's configured cache.

## Diagnose, build deliberately, search

<!-- poc:recipe workspace-diagnose shell=portable effects=read-only -->
```sh
node bin/pairofcleats.js workspace status --workspace "path/to/workspace.jsonc" --json
node bin/pairofcleats.js workspace catalog --workspace "path/to/workspace.jsonc" --json
```

Inspect each member/mode availability and its target-qualified next action.
Missing/stale/incompatible indexes are different from zero matches; disabled
members are intentionally excluded. A partial workspace answer must retain its
per-repository diagnostic attribution. Do not infer completion from an empty
catalog or an omitted repository.

Manifest refresh writes federation metadata; it is separate from read-only status:

<!-- poc:recipe workspace-refresh shell=portable effects=federation-manifest-write -->
```sh
node bin/pairofcleats.js workspace manifest --workspace "path/to/workspace.jsonc" --json
```

For a first small build, use explicit per-repository code builds from the
[first-search recipe](first-search.md), then validate each mode. The workspace
build owner also supports bounded fanout; review its current help before opting
into multiple target builds. No provider installation follows from membership.

Workspace build diagnostics distinguish selected, attempted, passed, failed,
skipped after strict failure and disabled repositories. `total` and `entries`
retain attempted outcomes; `skipped` lists retry candidates never started by this
invocation, and `excluded` identifies disabled members. `outcome: "no-work"`
explicitly means no build ran. The refreshed manifest can retain older valid
generations for unbuilt members; see [build outcomes](../contracts/workspace-build-outcomes.md).

<!-- poc:recipe workspace-search shell=portable effects=read-only -->
```sh
node bin/pairofcleats.js search --workspace "path/to/workspace.jsonc" --mode code --backend memory --top 5 --json -- "cache"
```

Choose a term that exists in your fixtures; this example is not a claimed result.
Results and diagnostics retain `repoId`/alias and source paths, so identical
relative filenames in two projects remain distinguishable. Check current search
help for explicit repository selection and cohort/strict controls rather than
inventing a member override in the membership file.

## Boundaries

Workspace membership, generated manifest/catalog, per-repo generations and the
federation query cache have distinct owners. Snapshot/as-of/cohort selection must
refer to compatible selected generations; inspect diagnostics for unsupported or
missing member snapshots. Federation does not imply cross-repository semantic
graph resolution, global catalog discovery or universal graph/context command
support. Use [graph/context contracts](../contracts/graph-tools-cli.md) for each
command's scope. Current HTTP/MCP routes are defined by
[their contract](../contracts/mcp-api.md), not proposed additions in old phase specs.

Ranked outer cache reuse also binds each selected repository/mode's effective
query policy. Search-only ranking changes invalidate reuse without rebuilding
the index. Child execution consumes the captured policy used for that identity;
see [effective search plan ownership](../contracts/effective-search-plan.md).

This authored journey and the new authoring fixtures are **UNVALIDATED** in the
current development batch. Two-disposable-repo execution, missing-index controls,
Windows path behavior and final-head source acceptance remain deferred.
