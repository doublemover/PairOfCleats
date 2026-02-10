# USR Language Contracts Index

Status: Draft v0.5
Last updated: 2026-02-10T07:40:00Z

This index lists per-language USR contract documents.

Parent contracts:

- docs/specs/usr-language-profile-catalog.md
- docs/specs/usr-normalization-mapping-contract.md
- docs/specs/usr-resolution-and-linking-contract.md
- docs/specs/usr-language-risk-contract.md
- docs/specs/usr-conformance-and-fixture-contract.md
- docs/specs/usr-embedding-bridge-contract.md
- docs/specs/usr-generated-provenance-contract.md

Mandatory per-language completion requirements:

- explicit dialect/version policy and feature-flag expectations
- explicit embedded-language hosting/embedded behavior policy
- explicit fixture minimum families and concrete fixture IDs
- explicit generated/macro provenance expectations
- explicit completion evidence artifact list
- explicit synchronization with language version/embedding policy matrices

## Baseline matrix

| Language | Parser | Conformance | Frameworks |
| --- | --- | --- | --- |
| javascript | hybrid | C0,C1,C2,C3,C4 | react,next |
| typescript | hybrid | C0,C1,C2,C3,C4 | react,next,angular |
| python | hybrid | C0,C1,C2,C3 | none |
| clike | hybrid | C0,C1,C2,C3 | none |
| go | hybrid | C0,C1,C2,C3 | none |
| java | hybrid | C0,C1,C2,C3 | none |
| csharp | hybrid | C0,C1,C2,C3 | none |
| kotlin | hybrid | C0,C1,C2,C3 | none |
| ruby | tree-sitter | C0,C1,C2,C3 | none |
| php | tree-sitter | C0,C1,C2,C3 | none |
| html | tree-sitter | C0,C1,C4 | vue,nuxt,svelte,sveltekit,angular,astro |
| css | tree-sitter | C0,C1,C4 | react,next,vue,nuxt,svelte,sveltekit,angular,astro |
| lua | tree-sitter | C0,C1,C2,C3 | none |
| sql | hybrid | C0,C1,C2,C3 | none |
| perl | heuristic | C0,C1,C2,C3 | none |
| shell | hybrid | C0,C1,C2,C3 | none |
| rust | hybrid | C0,C1,C2,C3 | none |
| swift | hybrid | C0,C1,C2,C3 | none |
| cmake | tree-sitter | C0,C1,C2 | none |
| starlark | tree-sitter | C0,C1,C2 | none |
| nix | tree-sitter | C0,C1,C2 | none |
| dart | hybrid | C0,C1,C2,C3 | none |
| scala | tree-sitter | C0,C1,C2,C3 | none |
| groovy | tree-sitter | C0,C1,C2,C3 | none |
| r | tree-sitter | C0,C1,C2,C3 | none |
| julia | tree-sitter | C0,C1,C2,C3 | none |
| handlebars | tree-sitter | C0,C1,C4 | none |
| mustache | heuristic | C0,C1,C4 | none |
| jinja | tree-sitter | C0,C1,C4 | none |
| razor | hybrid | C0,C1,C4 | none |
| proto | tree-sitter | C0,C1,C2 | none |
| makefile | tree-sitter | C0,C1,C2 | none |
| dockerfile | tree-sitter | C0,C1,C2 | none |
| graphql | tree-sitter | C0,C1,C2 | none |

## Language files
- docs/specs/usr/languages/javascript.md
- docs/specs/usr/languages/typescript.md
- docs/specs/usr/languages/python.md
- docs/specs/usr/languages/clike.md
- docs/specs/usr/languages/go.md
- docs/specs/usr/languages/java.md
- docs/specs/usr/languages/csharp.md
- docs/specs/usr/languages/kotlin.md
- docs/specs/usr/languages/ruby.md
- docs/specs/usr/languages/php.md
- docs/specs/usr/languages/html.md
- docs/specs/usr/languages/css.md
- docs/specs/usr/languages/lua.md
- docs/specs/usr/languages/sql.md
- docs/specs/usr/languages/perl.md
- docs/specs/usr/languages/shell.md
- docs/specs/usr/languages/rust.md
- docs/specs/usr/languages/swift.md
- docs/specs/usr/languages/cmake.md
- docs/specs/usr/languages/starlark.md
- docs/specs/usr/languages/nix.md
- docs/specs/usr/languages/dart.md
- docs/specs/usr/languages/scala.md
- docs/specs/usr/languages/groovy.md
- docs/specs/usr/languages/r.md
- docs/specs/usr/languages/julia.md
- docs/specs/usr/languages/handlebars.md
- docs/specs/usr/languages/mustache.md
- docs/specs/usr/languages/jinja.md
- docs/specs/usr/languages/razor.md
- docs/specs/usr/languages/proto.md
- docs/specs/usr/languages/makefile.md
- docs/specs/usr/languages/dockerfile.md
- docs/specs/usr/languages/graphql.md
