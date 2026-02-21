# Editor Packaging Determinism

## Scope

Canonical packaging commands:

- `npm run package-sublime`
- `npm run package-vscode`

Implemented by:

- `tools/package-sublime.js`
- `tools/package-vscode.js`
- shared archive logic in `tools/tooling/archive-determinism.js`

## Deterministic archive contract

Both packaging flows must enforce:

- stable file discovery order (lexicographic, POSIX separators)
- normalized root prefix (`PairOfCleats/` for Sublime, `extension/` for VS Code)
- fixed archive mtime for all entries (`2000-01-01T00:00:00.000Z`)
- normalized mode bits (`0644` files, `0755` executables)
- deterministic checksum output (`sha256`)

## Required outputs

Sublime:

- `dist/sublime/pairofcleats.sublime-package`
- `dist/sublime/pairofcleats.sublime-package.sha256`
- `dist/sublime/pairofcleats.sublime-package.manifest.json`

VS Code:

- `dist/vscode/pairofcleats.vsix`
- `dist/vscode/pairofcleats.vsix.sha256`
- `dist/vscode/pairofcleats.vsix.manifest.json`

Manifest schema version is `1` and includes checksum, fixed mtime, toolchain metadata, and full archive entry list.

## Toolchain policy

Packaging is strict and fails fast when required toolchains are unavailable.

- Sublime packaging requires Python runtime availability.
- VS Code packaging requires npm availability.

## Smoke mode

Both commands support `--smoke` to perform a strict package generation check and fail on missing outputs.
