# Execution, storage and download authority

Repository contents are analysis input. Opening or indexing a repository does
not grant its configuration permission to choose executable code, native
libraries, credentials or destructive storage roots.

## Configuration sources

Ordinary `.pairofcleats.json` settings still select analysis features and bounded
resource tuning. By default the loader ignores repository-selected Node
options, cache/asset/tool directories, executable command/argument overrides,
custom LSP servers, TypeScript module search order and native-extension source
configuration. These settings are not converted into child-process authority.

Advanced user configuration is supported through launch-owned controls:

- `PAIROFCLEATS_TRUSTED_CONFIG` selects an absolute schema-validated JSON/JSONC file outside
  the target repository. Keep this file in user-owned configuration storage and
  use absolute paths for storage/executable overrides. Its values override the
  untrusted repository settings.
- `PAIROFCLEATS_TRUSTED_REPOS` is a JSON array of exact absolute canonical repository
  roots. This deliberately grants a listed repository execution/configuration
  authority, including local tooling. It does not trust parent directories or
  other repositories. Prefer the narrower user configuration file when possible.
- Existing launch environment controls such as `NODE_OPTIONS`,
  `PAIROFCLEATS_NODE_OPTIONS`, `PAIROFCLEATS_CACHE_ROOT` and asset-directory
  overrides remain user-owned authority. Do not derive them from repository data.

Automatic tooling skips repository `node_modules/.bin` and repository-owned
TypeScript compiler modules unless the root has that external trust grant.
Canonical command containment is checked before version/help probing, and a
blocked profile cannot fall back into a stdio launch. Trusted installed/tool-cache
providers remain available. A language server may itself have project-specific
execution features; this policy is not an operating-system sandbox for third-party
servers or a claim that arbitrary project plugins are safe.

Python and Tree-sitter worker counts are clamped before pool construction to the
launch CPU/thread budget and a conservative maximum of four. Repository
`allowOverCap` settings cannot remove that ceiling. A one-thread launch therefore
keeps both pools at at most one worker.

## Editor integrations

VS Code execution requires `workspace.isTrusted === true` at the actual process
and API-request sinks, including startup/background work, saved workflows and
commands that waited for prompts. The extension declares no untrusted-workspace
execution support. Repository CLI discovery is no longer implicit; select an
explicit CLI path for trusted development installations or use the installed CLI.

API credentials come from user-scoped settings or the launch environment. They
attach only when the actual request destination has the exact origin explicitly
configured at user scope. Workspace-only endpoint/environment settings do not
receive an ambient user token. Scheme, host and port all participate in that
binding, including saved requests and capability probes. Authenticated redirects
are not followed. Loopback HTTP remains available through explicit user settings.

Sublime retains data/search project settings while executable, environment and
API-endpoint selection comes from user preferences. Repository-owned CLI entrypoints
are not automatically preferred. Explicit user-level paths remain supported.

## TUI implementation paths

The JavaScript wrapper pins the Node executable and supervisor to its own package
installation, verifies the supervisor digest in installation metadata, and starts
the native program in the trusted package directory. Rust requires the supplied
absolute paths and has no cwd-relative supervisor or unqualified Node fallback.
The caller workspace is carried separately for session scope and job cwd defaults.
Reinstall after changing the supervisor so its companion digest is refreshed.
The native-source change needs a rebuilt native artifact for that new launch
contract; the wrapper's trusted cwd also contains the legacy relative-script path.

## Destructive maintenance

Cleanup targets must be canonically contained beneath launch/user-owned storage
and have no symlinked ancestors. An approved storage root must contain a regular
`.pairofcleats-cache-owner.json` marker with `owner: "pairofcleats"` and
`layoutVersion: 1`. A repository cannot supply a replacement cache root by default.
All targets are validated before `clean-artifacts` or uninstall deletes anything.

Existing unmarked caches fail closed. Inspect the dry-run first; the explicit
maintenance CLI option `--allow-unmarked-cache` permits legacy cleanup while
retaining the approved-root and no-symlink checks. This option is not exposed by
MCP. Repository-scoped MCP cleanup also rejects `all: true`; global maintenance
belongs to the user-owned CLI. A marker is an ownership/layout guard, not a
cryptographic defense against a local actor who already controls user storage.

## Native artifacts and network requests

Native-extension downloads always require an approved SHA256 digest, even when
ordinary data-download policy is less strict. Downloads stage verified bytes in
an exclusively created transaction directory and publish the finished artifact
atomically. The registry records both source and output digests, provider and
platform. Native loading rechecks approved provenance and current file bytes.

MCP uses the user's configured native source/artifact, not caller URL/output/path
overrides. Verification is non-loading by default. `PAIROFCLEATS_MCP_ALLOW_NATIVE_LOAD=1`
is a separate launch-time authorization for loading an already approved artifact.
Direct CLI loading is explicit (`--load`) and can use an explicitly approved binary
digest. Protect the user-owned configuration, installed package and cache from
untrusted writers; this is not a sandbox against an already-compromised same-user
process replacing trusted files during native dynamic loading.

PHPactor PHAR installation is manual until a maintained trusted release manifest
is available. It requires an immutable artifact URL and explicit SHA256 digest,
rejects mutable latest URLs, limits the response to 32 MiB, and does not follow
redirects implicitly. No executable shim is created before verification succeeds.

The shared data/native downloader requires HTTPS and public address classification
for every connection. Its validated DNS answer is the answer supplied to the
socket. Private, loopback, link-local, reserved and mixed public/private answers
fail closed. HTTPS downgrades are rejected. Cross-origin redirects require an
origin in the launch-owned JSON array `PAIROFCLEATS_DOWNLOAD_REDIRECT_ORIGINS`;
authorization/cookie headers are dropped across an approved origin change.
`PAIROFCLEATS_ALLOW_LOCAL_DOWNLOADS=1` is an explicit local-development opt-in,
not a repository setting. Request bytes, timeout and redirect count remain bounded.
Custom MCP dictionary sources additionally require an exact URL/digest entry in
the user-owned download policy and use the user-owned dictionary directory.

Download names must be a single safe filename. TAR directory/special entries
consume the same entry budget as files, limits cannot be disabled by repository
configuration, and every failed extraction/download transaction removes its
temporary archive and extraction tree. Archive paths are bounded to 4096
characters and 64 segments. These checks do not replace a trusted
native-artifact digest.

## Repository reads and validation boundary

Index content and context excerpts use no-follow, regular-file descriptors with
post-open canonical/identity checks. Linux additionally checks the actual opened
object through its descriptor path. Index reads compare recorded discovery
identity/size and use a bounded descriptor-sized read; stale or changing files
fail closed. Context paths are revalidated even before cached excerpts are used.

Focused synthetic regressions cover these authority boundaries. They use inert
bytes, controlled temporary directories and loopback test servers; they do not
load arbitrary native code, send real credentials or contact private services.
Linux checks do not establish Windows/macOS native acceptance. Platforms without
Linux descriptor-path support retain no-follow and canonical/descriptor-identity
checks; fully hostile concurrent filesystem mutation is not an OS sandbox claim.
Full SDK/LSP, native TUI build and release-wide campaigns remain separate acceptance.
GitHub CI and hosted security scan state are unchanged by these local checks.
