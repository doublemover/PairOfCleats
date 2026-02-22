# Tree-Sitter Package Audit (2026-02-22)

This audit covers language IDs that were still on heuristic/config chunkers after the initial tree-sitter expansion.
Signals used:
- npm package description/version/publish date/downloads/maintainers
- GitHub repository push recency and archive status (when available)
- security-holding package markers

## Adopt Now

| Language | Package | Why |
| --- | --- | --- |
| `dart` | `@sengac/tree-sitter-dart@1.1.6` | Recent publish (2025-11-14), active repo, non-trivial downloads. |
| `scala` | `tree-sitter-scala@0.24.0` | Official tree-sitter repo, strong adoption, maintained. |
| `groovy` | `tree-sitter-groovy@0.1.2` | Modest adoption, maintained package/repo, no better npm alternative found. |
| `r` | `@eagleoutice/tree-sitter-r@1.1.2` | Active `r-lib/tree-sitter-r` upstream; avoids `tree-sitter-r@0.0.1-security`. |
| `julia` | `tree-sitter-julia@0.23.1` | Official tree-sitter repo, maintained, meaningful adoption. |

## Defer For Now

| Language | Best candidate found | Reason for deferral |
| --- | --- | --- |
| `cmake` | GitHub-only `uyha/tree-sitter-cmake` | No maintained npm package found for native runtime consumption. |
| `starlark` | `tree-sitter-starlark@1.3.0` | Very low adoption and single maintainer. |
| `nix` | `tree-sitter-nix@0.0.2` | Stale npm release cadence; very low adoption. |
| `handlebars` | none | No usable native npm grammar package found. |
| `mustache` | none | No usable native npm grammar package found. |
| `jinja` | `tree-sitter-jinja2@0.2.0` / `tree-sitter-jinja@0.3.3` | Archived/stale or very low-adoption options only. |
| `razor` | none | No usable native npm grammar package found. |
| `proto` | none | No usable native npm grammar package found. |
| `makefile` | `tree-sitter-make@1.1.1` | Low adoption and weak maintenance signals. |
| `dockerfile` | `tree-sitter-dockerfile@0.0.1-security` | Security-holding package; not a real grammar runtime. |
| `graphql` | `tree-sitter-graphql@1.0.0` | Stale package and weak maintenance signals. |
| `ini` | none | No usable native npm grammar package found. |

## Notes

- Coverage here is intentionally conservative for native grammar adoption.
- Heuristic chunkers remain the fallback path for deferred languages.
