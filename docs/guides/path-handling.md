# Path Handling

This project enforces a strict, cross-platform path policy for release-critical and artifact-writing flows.

## Core rules

- Never build paths via string concatenation.
- Normalize paths at module boundaries (CLI input, config load, artifact write).
- Preserve interior spaces and treat them as valid path content.
- Normalize separators before comparisons.
- Normalize Windows drive letters to uppercase (`c:` -> `C:`).
- Preserve UNC roots on Windows (`\\server\share\...`) and validate them explicitly.
- Reject boundary escapes using `path.relative(...)` + absolute-path checks.

## Canonical helpers

Use these helpers from `src/shared/path-normalize.js`:

- `normalizePathForPlatform(value, { platform })`
- `normalizeWindowsDriveLetter(value)`
- `normalizeRepoRelativePath(value, repoRoot)`
- `normalizePathForRepo(value, repoRoot)`
- `joinPathSafe(baseDir, segments)`

Use these helpers from `src/shared/files.js`:

- `toPosix()` / `fromPosix()` for canonical storage and IO conversion
- `isAbsolutePathNative()` for platform-native absolute checks
- `isAbsolutePathAny()` only when dual-platform interpretation is required
- `isUncPath()` for UNC detection in Windows-sensitive flows

## Atomic write policy

`src/shared/io/atomic-write.js` now normalizes and validates target paths before temp-write/rename. The write target must remain inside its resolved parent boundary.

## Required edge-case coverage

Tooling/release path tests must cover:

- paths with spaces
- drive-letter normalization
- UNC paths
- mixed separators
- traversal/escape rejection

## Examples

- `normalizePathForPlatform('C:/Repo\\src\\app.js', { platform: 'win32' })` -> `C:\Repo\src\app.js`
- `normalizePathForPlatform('\\\\srv/share//project\\file.txt', { platform: 'win32' })` preserves UNC root and normalizes separators
- `joinPathSafe('C:\\repo', ['..', 'outside'])` returns `null`
