# Editor Packaging Determinism

## Scope

Canonical packaging commands:

- `node tools/package-sublime.js`
- `node tools/package-vscode.js`

Implemented by:

- `tools/package-sublime.js`
- `tools/package-vscode.js`
- shared archive logic in `tools/tooling/archive-determinism.js`

## Deterministic archive contract

Both packaging flows must enforce:

- stable file discovery order (lexicographic, POSIX separators)
- canonical package layout: Sublime plugin/resources at archive root; VS Code
  payload under `extension/` plus root `extension.vsixmanifest` and `[Content_Types].xml`
- fixed archive mtime for all entries (`2000-01-01T00:00:00.000Z`)
- normalized mode bits (`0644` files, `0755` executables)
- deterministic checksum output (`sha256`)

## Required outputs

Sublime:

- `dist/sublime/PairOfCleats.sublime-package`
- `dist/sublime/PairOfCleats.sublime-package.sha256`
- `dist/sublime/PairOfCleats.sublime-package.manifest.json`

VS Code:

- `dist/vscode/pairofcleats.vsix`
- `dist/vscode/pairofcleats.vsix.sha256`
- `dist/vscode/pairofcleats.vsix.manifest.json`

Manifest schema version is `1` and includes checksum, fixed mtime, toolchain metadata, and full archive entry list.

## Toolchain policy

Packaging is strict and fails fast when required toolchains are unavailable.

- Sublime packaging requires Python runtime availability.
- VS Code packaging requires npm availability.

VS Code uses the exact locked development dependency `@vscode/vsce@4.0.0` to
produce the complete container. The shared archive owner normalizes every emitted
file, including required metadata, and validates identity, version, engine,
assets and the local CommonJS runtime dependency closure before publication.
Local packaging has no publisher credential or marketplace publication step.
`skipLicense` prevents an interactive license-presence prompt; it does not establish
distribution licensing. This repository has no declared license to infer.

Sublime's filename is `PairOfCleats.sublime-package`, matching the unpacked
`Packages/PairOfCleats/` identity and contract resource URI. The plugin reports
legacy lowercase/nested archives and loose files overriding an installed archive;
it preserves all user installation files. See the host's
[package layout](https://www.sublimetext.com/docs/packages.html) and
[plugin loading rules](https://www.sublimetext.com/docs/api_environments.html).

Archive qualification is distinct from host acceptance. The release install
stage verifies the actual archive and then returns a blocked, nonzero result
until official/supported host installation, activation, fixture search and
uninstallation are demonstrated. Unpacking and Python import controls are never
recorded as a successful editor installation. VSIX format generation follows the
[official packaging workflow](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## Smoke mode

Both commands support `--smoke` to perform a strict package generation check and fail on missing outputs.
