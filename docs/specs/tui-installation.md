# TUI Installation & Distribution Spec (compile-on-install + prebuilt fallback)

This spec defines how the Rust Ratatui TUI binary is delivered in a Node/npm-based repo. It explicitly supports:
- **Optional compile-on-install**
- **Fallback to verified prebuilt binaries**

Status: **proposed design only** (not implemented in the current tree as of 2026-02-17).
Any `tools/tui/*` paths in this document are planned touchpoints, not active commands.

> This is analogous to the repo’s existing “download native binaries” flow for extensions (see `tools/download/extensions.js` and config in `tools/sqlite/vector-extension.js`).

---

## 1) Goals / Non-goals

### Goals
- `npm install` produces a usable `pairofcleats-tui` command on common platforms.
- If Rust toolchain is present (and user opts in), compile locally.
- Otherwise, download a prebuilt binary with integrity verification.
- If neither works, fall back to the existing Node CLI with clear guidance.

### Non-goals
- Guarantee a Rust toolchain on all environments.
- Compile by default in CI/consumer installs without user opt-in.

---

## 2) User-facing commands

### 2.1 New bin entry
Add to `package.json`:
```json
"bin": {
  "pairofcleats": "bin/pairofcleats.js",
  "pairofcleats-tui": "bin/pairofcleats-tui.js"
}
```

### 2.2 Wrapper behavior (`bin/pairofcleats-tui.js`)
- Locate native binary under `bin/native/`:
  - `bin/native/pairofcleats-tui` (POSIX)
  - `bin/native/pairofcleats-tui.exe` (Windows)
- If present:
  - `spawn`/`execFile` the native binary and forward args, inheriting stdio.
- If missing:
  - Print a concise message:
    - how to enable build-on-install
    - how to download prebuilt
    - how to fall back to `pairofcleats` Node CLI

---

## 3) Binary layout (repo)
Recommended layout:
- `bin/native/`
  - `pairofcleats-tui[.exe]` (current platform)
  - `manifest.json` (what was installed, version, sha256)
- `crates/pairofcleats-tui/` (Rust source)

Manifest example:
```json
{
  "version": "0.3.0",
  "installedAt": "2026-01-30T12:00:00.000Z",
  "platform": "win32-x64",
  "method": "download|build",
  "sha256": "..."
}
```

---

## 4) Install-time flow

### 4.1 postinstall entrypoint
Add to `package.json`:
```json
"scripts": {
  "postinstall": "node tools/setup/postinstall.js && node tools/tui/install.js"
}
```

### 4.2 Installer logic (`tools/tui/install.js`)
**High-level decision tree**
1. If `PAIROFCLEATS_TUI_DISABLE=1` → do nothing.
2. If `PAIROFCLEATS_TUI_BUILD=1` OR `npm_config_build_from_source=true`:
   - If `cargo` is available:
     - build from source (release)
     - install binary into `bin/native/`
   - Else:
     - continue to download flow
3. Attempt download prebuilt for `(platform, arch)` with verification.
4. If download fails:
   - emit warning and exit 0 (do not fail npm install)
   - wrapper will guide user at runtime

### 4.3 Compile-on-install details
- Check `cargo` via `spawnSync("cargo", ["--version"])`.
- Build command:
  - `cargo build --release -p pairofcleats-tui`
- Output binary path:
  - `target/release/pairofcleats-tui[.exe]`
- Copy to `bin/native/` and `chmod +x` on POSIX.

**Opt-in knobs**
- `PAIROFCLEATS_TUI_BUILD=1` (recommended primary)
- `npm_config_build_from_source=true` (npm-style)
- `PAIROFCLEATS_TUI_PROFILE=release|debug` (optional)

### 4.4 Prebuilt download details
Follow the pattern and security posture of `tools/download/extensions.js`:
- A **download allowlist** / explicit URLs
- SHA-256 verification required
- Archive extraction limits (if using `.tar.gz`/`.zip`):
  - maxBytes, maxEntries, maxEntryBytes

**Recommended artifact naming**
- `pairofcleats-tui-${version}-${platform}-${arch}.tar.gz`
  - platform: `win32`, `darwin`, `linux`
  - arch: `x64`, `arm64`

**Config surface**
- `.pairofcleats.json` additions:
```json
{
  "tui": {
    "enabled": true,
    "install": {
      "allowDownload": true,
      "provider": "github-releases",
      "baseUrl": "...",
      "sha256": { "win32-x64": "...", "darwin-arm64": "..." }
    }
  }
}
```

(You can mirror the `sqlite.security.downloads` shape used by `tools/download/extensions.js` if you want a unified policy surface.)

---

## 5) Fallback guidance (runtime)
If the wrapper can’t find a binary:
- Suggest:
  1. `PAIROFCLEATS_TUI_BUILD=1 npm install` (build from source)
  2. `node tools/tui/download.js` (planned command for prebuilt download)
  3. Use Node CLI: `pairofcleats ...`

---

## 6) CI / release responsibilities
To make prebuilt binaries available:
- Add a CI job that builds the Rust binary for target triples.
- Upload artifacts and publish checksums.
- Ensure version matches `package.json` version.

---

## 7) Testing
- Installer unit tests:
  - “cargo present” path produces binary + manifest
  - “download path” verifies sha mismatch fails
  - installer does not hard-fail npm install on missing binary
- Wrapper test:
  - when binary missing, exit code is non-zero and guidance printed
  - when binary present, wrapper execs it

---

## 8) Repository references
- Existing “native download + verify” patterns:
- `tools/download/extensions.js`
- Process spawn helpers and kill-tree:
  - `src/shared/subprocess.js`
