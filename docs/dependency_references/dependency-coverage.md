# Dependency reference coverage

Snapshot date: 2026-01-26

## Sources
- Dependency list: package.json dependencies + optionalDependencies.
- Reference inventory: docs/dependency_references/dependency-bundle/manifest.json (sheets under docs/dependency_references/dependency-bundle/deps/).

## Coverage summary
- Total dependencies: 84
- Covered by dependency-bundle sheets: 60
- Missing sheets: 24
- Extra sheets not in package.json: 0

## Missing dependency references
Add a dependency-bundle sheet + manifest entry for each of the following packages:

- @babel/parser
- @node-rs/xxhash (optional)
- @parcel/watcher (optional)
- acorn
- adm-zip
- cjs-module-lexer
- es-module-lexer
- escomplex
- eslint
- esprima
- node-sql-parser
- p-queue
- re2 (optional)
- selfsigned
- simple-git
- snowball-stemmers
- tar-fs
- terminal-kit
- three
- tree-sitter-wasms
- vscode-jsonrpc
- vscode-languageserver-protocol
- web-tree-sitter
- yargs

## Notes
- Update the dependency-bundle manifest and add a deps sheet for each missing package.
- If a dependency is intentionally excluded, document the rationale here.
