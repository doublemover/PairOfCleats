# Dependency security and compatibility

## October 2026 remediation

The pre-remediation npm audit reported 37 affected package entries containing
147 distinct advisory URLs (3 critical, 22 high, 11 moderate and 1 low package
entries). The dated updated-graph audit at the recorded October 2 checkpoint
reported zero known vulnerabilities, including development and optional
dependencies. That is a historical receipt, not a current-head clean-audit claim.
A later braces development-tool advisory was reproduced on October 5 as seven
high-severity npm package entries. Its limited exposure did not make it fixed.
The dependency-path replacement below addresses that follow-through without
suppressing the audit gate or advisory baseline.

The authenticated GitHub Security inventory contained **150 open Dependabot
alerts** across 29 package families: 3 critical, 68 high, 75 moderate, and 4 low.
Those are per-alert counts, distinct from npm's per-package counts above. Every
observed alert ID and its family-level installed-version/removal reconciliation
is preserved in the [dated inventory](../security/dependabot-inventory-2026-10-02.json).
27 families have patched versions; `fast-xml-parser` and `js-yaml` are absent.
These branch changes do not close GitHub's default-branch alerts until merge and
rescan. No alerts were dismissed and no scanner was weakened.

Secret scanning showed zero open and zero closed findings. Code scanning showed
zero open and 46 closed findings on main, but its last scan was 2026-03-14 at
`b9398da`; the CodeQL workflow is disabled due to inactivity and reported a
historical alert-location-limit warning. Malware scanning is disabled. Those
states are not a fresh clean security scan. Hosted security settings remain
unchanged. CodeQL/rescan and broader CI acceptance are deferred; no current
preparation, monitoring or execution is implied by this historical inventory.

The repair uses supported upstream releases and normal semver resolution:

- Replace the unmaintained `@xenova/transformers` 2.x dependency tree with
  `@huggingface/transformers` 4.3, ONNX Runtime 1.30 and patched Sharp. Keep the
  `xenova` provider identifier, model IDs, q8 weights, mean pooling, normalization
  and existing model caches. See [embedding compatibility](embeddings.md).
- Upgrade the vulnerable direct archive, serialization, worker-pool, Git,
  pattern-matching, configuration, Svelte and regular-expression dependencies.
- Remove stale overrides for tar, Hono, minimatch and other transitive packages
  so compatible upstream security releases can resolve normally. Do not restore
  a global minimatch 3 override across consumers expecting newer major versions.
- Incorporate the outstanding c8, ESLint, jsdoccomment, SWC and yargs update
  proposals. Use c8 12 because c8 10 still brings an unsupported glob release.
  The local ESLint rule now uses the supported `context.sourceCode` API.
- Remove unused Nunjucks, whose optional Chokidar 3 peer conflicted with the
  application's Chokidar 5 watcher. Add Graphology's required types peer.
- Raise the runtime minimum and CI/release pins to Node 24.15.0, required by the
  patched RE2/native build toolchain. Historical validation records retain the
  Node version on which they actually ran.

The [offline regression baseline](../../tests/fixtures/security/dependency-advisories-2026-10-02.json)
checks every locked package, including nested and cross-platform optional copies,
against the known vulnerable ranges. CI also runs `npm audit --audit-level=low`
against current advisories. The baseline is a regression check, not a substitute
for the live advisory database. An audit/network error is not a clean result.

## October 6 current-advisory follow-through

The automatic CI run at `5e81db47` passed native installation and then reported
eight affected package entries from five advisory families. The targeted update
below removes those paths; the dated local full-graph audit reports zero known
vulnerabilities, including development and optional packages. Hosted acceptance
of these changes and Windows/macOS runtime verification remain separate.

| Dependency path | Resolution | Compatibility review |
| --- | --- | --- |
| `simple-git` → `@simple-git/argv-parser` | 4.0.2 → 2.0.1 | Four application imports use the named `simpleGit` export. Existing read-only Git commands use complete options and retain the default environment/unsafe-operation guards. |
| `pino-pretty` → `fast-copy` | 4.0.2 → 4.1.2 | New depth limit, independent Buffer bytes, and DataView bounds are exercised alongside normal formatted error logs. |
| Optional MCP SDK → Express → `proxy-addr` | 2.0.7 → 2.0.8 | IPv4-mapped trust masks are corrected. PoC uses the SDK's stdio transport; it does not configure Express trust-proxy behavior. The installed transitive API is tested with trusted and untrusted addresses. |
| CSS/compiler consumers → `source-map-js` | 1.2.1 → 1.2.2 | Normal map round trips, PostCSS output maps and Vue scoped CSS survive the indexed-section offset validation. |
| `mammoth` → `argparse` → `sprintf-js` | Mammoth 1.13.0; scoped argparse 2.0.1; sprintf absent | Exact Mammoth pin plus a single-file CLI patch uses argparse's native v2 API without deprecation shims. |

The [Git 4 release notes](https://github.com/steveukx/git-js/releases/tag/simple-git@4.0.0)
remove the default export, deprecated APIs and abbreviated options, and filter
sensitive ambient environment variables. PoC uses repository roots and read-only
status, revision, log, blame and remote-list queries; it does not use removed
methods or enable unsafe environment forwarding. Real-repository tests cover all
four consumers, file paths with spaces, churn/blame, dirty status, and MCP status.
Ambient `GIT_DIR` no longer redirects those calls; explicit unsafe `VISUAL` is
rejected. The [4.0.1 release](https://github.com/steveukx/git-js/releases/tag/simple-git@4.0.1)
fixes publication metadata; [4.0.2](https://github.com/steveukx/git-js/releases/tag/simple-git@4.0.2)
includes the patched editor-variable detection.

The [fast-copy changelog](https://github.com/planttheidea/fast-copy/blob/master/CHANGELOG.md)
adds a default depth limit of 1,000, throwing a catchable `MaxDepthExceededError`
that extends `RangeError`; it also corrects BigInt typed arrays, Buffer ownership,
tag lookup and DataView bounds. PoC has no custom copier or direct runtime call;
its pretty-log formatter is the consumer. The depth limit remains enabled.
[proxy-addr 2.0.8](https://github.com/jshttp/proxy-addr/releases/tag/v2.0.8)
is the trust-mask fix. [source-map-js 1.2.2](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)
also fixes browser CSP compatibility. Its offset cap rejects invalid or excessive
indexed maps instead of attempting unbounded line padding; ordinary maps retain
their API and format.

[Mammoth's release notes](https://github.com/mwilliamson/mammoth.js/blob/1.13.0/NEWS)
include Windows image-output traversal, styles prototype-pollution and parsing
backtracking fixes in 1.12.1–1.12.3. Version 1.13 replaces Bluebird with native
promises, recognizes custom XML/moved text and improves Markdown escaping.
PoC awaits `extractRawText({buffer})` and reads the result fields, so it needs no
promise adapter. Its output may now include text that older Mammoth omitted.

Upgrading Mammoth alone retains argparse 1.x and vulnerable sprintf-js, which has
no patched release for this advisory. The scoped override avoids a global parser
change; the existing checked package-patch installer applies
`patches/mammoth+1.13.0.patch`. It preserves CLI argument names, choices, output
paths and mutual exclusion while using snake_case methods, `String` types and
the v2 `default` option. Argparse 2's absent values become `undefined` instead of
`null`; Mammoth's truthiness checks support both. See the
[v1-to-v2 migration guide](https://github.com/nodeca/argparse/blob/2.0.1/doc/migrate_v1_to_v2.md).
Argparse 3's additional help/parser changes are unnecessary for this fix.
Real DOCX tests require the Mammoth backend, compare text and image bytes, run
conversion/error cases under `--throw-deprecation`, and verify first/repeated
patch application plus version/partial-patch rejection. Do not accept npm's
suggested Mammoth downgrade or restore sprintf-js.

The [additional regression baseline](../../tests/fixtures/security/dependency-advisories-2026-10-06.json)
records the five advisory ranges with official links. The historical October 2
baseline and live `npm audit --audit-level=low` gate remain active. Native package
versions are unchanged; installation verification and real CPU inference still
run independently of the audit.

## October 5 development-tool dependency paths

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
affects braces through 3.0.3 and has no patched release at this checkpoint.
The failures came through jscpd's old fast-glob/micromatch chain and
patch-package's find-yarn-workspace-root/micromatch chain. Raising Node versions
alone does not fix this advisory.

- jscpd moves from 4.2.3 to the official 5.4.0 Rust-based CLI. Its native npm
  packages cover macOS x64/arm64, Linux x64/arm64 GNU/musl, and Windows x64/arm64.
  The existing duplicate-scan command and configuration remain the integration
  surface; no semantic-model download or additional analysis is enabled.
  `--absolute` keeps multi-root report paths unambiguous. The new tokenizer is
  not numerically equivalent to 4.x: a controlled 33-line JavaScript duplicate
  reports 311 tokens in 5.4.0 versus 527 in 4.2.3, and aggregate line counting
  also differs. The configured 8-line/80-token minima are retained, but boundary
  detection and historical duplication totals are not promised identical. Do
  not compare old/new percentages as a code-quality trend without recalibration.
  The focused CLI contract checks all six roots, ignores, file-size/symlink
  exclusions, JSON/Markdown reporters, minima, and a failing percentage threshold.
  Platform package availability is checked in the lock graph; runtime execution
  was checked on Linux, while macOS/Windows execution belongs to platform CI.
- The three checked-in native build patches remain unchanged. A repository-owned
  `node tools/setup/apply-patches.js` applies them through Git instead of retaining
  patch-package's vulnerable workspace-discovery dependency. Source installs
  require Git on PATH. Required patches still fail closed rather than being
  skipped, and native rebuilding remains a separate required bootstrap step.
- `npm audit --audit-level=low` still includes development and optional packages.
  The regression contract additionally rejects the later vulnerable braces range.
  No npm override, advisory exception, scanner exclusion, or forced downgrade is
  used to produce a clean audit.

The source-checkout bootstrap scripts use the same helper as postinstall.
Historical commands and audit counts elsewhere in this document describe their
dated checkpoints; they are not claims about a fresh run.

## Rust dependency remediation

An offline cargo-audit 0.22.2 review of the TUI lockfile against the official
RustSec snapshot `6de4455103aced2cba86e3b86e5c090b22827cf1` (2026-10-01)
found three unsoundness advisories in the original 196-package graph:
`RUSTSEC-2026-0190` (anyhow), `RUSTSEC-2026-0253` (lru), and
`RUSTSEC-2026-0097` (rand). These are warnings in cargo-audit, so its original
zero-vulnerability count alone did not mean the graph was clean.

Cargo resolution updates anyhow to 1.0.104, ratatui to 0.30.2, ratatui-core to
0.1.2, lru to 0.18.5, and rand to 0.8.8. Ratatui's patched core is needed to
accept the fixed lru release. It requires Rust 1.88, so the TUI's declared MSRV,
toolchain, and workflow pins are aligned to 1.88.0. Workflow triggers and
security permissions are unchanged.

The updated 206-package lock passes the same offline audit with
`--deny warnings`: zero vulnerabilities and zero warnings, with no ignored
advisories. The TUI toolchain/advisory contract test also passes. All 205 registry
packages match their official sparse-index checksums and are unyanked in the
snapshot fetched during Cargo resolution; no fresh live yanked-crate refresh is
claimed. No declared dependency MSRV exceeds 1.88, but 65 crates omit that
metadata, so actual compilation was also checked with Rust 1.88.0. On Linux,
`cargo check --locked --all-targets` and `cargo test --locked --no-run` pass.
`cargo test --locked` exits successfully, but the crate defines zero Rust unit
tests; this is not a behavioral test-suite pass. Windows/macOS builds, interactive
TUI behavior, formatting/clippy and local CodeQL remain separate validation.

## Native grammar peer metadata

The existing `legacy-peer-deps=true` installation policy is retained because
grammar packages declare mutually incompatible core peer ranges. Several declare
Tree-sitter 0.21/0.22 while current grammars require the selected 0.25 core; Dart
declares a separate `@sengac/tree-sitter` fork even though its native language
binding can be consumed by the application's upstream parser.

These declarations are not rewritten or hidden with forced peer overrides.
Consequently, `npm ls --all` still reports the core peer-range conflict and Dart's
uninstalled alternate-core peer. They are packaging metadata limitations, and
must not be represented as a clean npm peer tree. Replacing the parser solely to
satisfy those ranges would break the newer grammar ABI requirements.

Validate runtime compatibility with both native activation and semantic tests:

```sh
node tools/setup/rebuild-native.js --verify
node tests/indexing/tree-sitter/scheduler-native-language-contract.test.js
node tests/indexing/tree-sitter/perl-native-reset-regression.test.js
```

The remediation was verified on Linux with all 33 registered language bindings
activating and parsing, plus 21 semantic fixtures spanning 19 grammar keys. The
platform CI jobs remain responsible for Windows and macOS validation.

## Installation and verification

Use `npm run bootstrap:ci` for a clean install with the checked-in lockfile and
package patches. After an intentional `npm install --ignore-scripts`, run
`node tools/setup/apply-patches.js` before
`node tools/setup/rebuild-native.js --repair`, then verify native dependencies;
an audit result alone does not show that native binaries are usable.

```sh
npm audit --audit-level=low
node tests/ci/dependency-security-contract.test.js
node tests/ci/eslint-rule-compatibility.test.js
node tests/indexing/embeddings/transformers-quantized-compatibility.test.js
```

Do not use `npm audit fix --force` to downgrade Transformers.js to the obsolete
1.4.2 version suggested for the old Xenova tree. Upgrading the supported provider
and testing actual local inference removes the vulnerable dependency path.

Relevant upstream migration references:

- [Transformers.js quantized model selection](https://huggingface.co/docs/transformers.js/guides/dtypes)
- [ESLint 10 custom-rule migration](https://eslint.org/docs/latest/use/migrate-to-10.0.0)

## Grouped dependency PR follow-through

PR #518 (`39b0b892c8091ead68cadb4316b3600833745d30`) was reviewed after its
four head checks passed. Its seven declared upgrades already match or are
superseded by this branch; its transitive security targets are patched or absent
from the current graph. Merging that PR unchanged into main would retain a
Node >=24.13 declaration despite updated native dependencies requiring 24.15+.
The completion branch already declares the compatible minimum.

The remaining distinct lock resolution, optional node-gyp 13.1.0, is incorporated
from the reviewed PR lock entry. Its engine range is unchanged; its tighter tar
floor is satisfied by the existing 7.5.22 resolution, and all dependency edges
satisfy their ranges. The security/engine contract passes. This was a lock-only
integration: the shared installed tree remains at node-gyp 13.0.2, and no current-
branch native rebuild or new live audit is claimed for this follow-through.
