# Path Handling

This project uses a consistent path policy to avoid cross-platform edge cases.

Principles:
- Use Node `path` with platform-specific variants (`path.posix` on POSIX, `path.win32` on Windows).
- Keep paths opaque for display/logging; normalize only when comparing or storing.
- For security checks, use platform-specific absolute detection plus `path.relative`.
- Store internal paths in POSIX form and convert at IO boundaries.
- Use `toPosix()` and `fromPosix()` from `src/shared/files.js` for canonical conversions.
- Use `normalizeRepoRelativePath()` and `normalizePathForRepo()` from `src/shared/path-normalize.js` when accepting repo-rooted inputs.
- Use `normalizeFilePath()` from `src/shared/path-normalize.js` for stable comparisons.
- Prefer `isAbsolutePathNative()` for native checks and reserve `isAbsolutePathAny()` for explicit cross-platform validation.

Examples:
- `isAbsolutePathNative('C:/foo')` is false on POSIX, true on Windows.
- Manifest paths are validated with native absolute checks and `..` segment checks.
