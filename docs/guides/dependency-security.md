# Dependency security and compatibility

## October 2026 remediation

The pre-remediation npm audit reported 37 affected package entries containing
147 distinct advisory URLs (3 critical, 22 high, 11 moderate and 1 low package
entries). The updated complete dependency graph audits with zero known
vulnerabilities, including development and optional dependencies.

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
unchanged; local CodeQL validation is being prepared separately.

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
native patches. After an intentional `npm install --ignore-scripts`, use
`node tools/setup/rebuild-native.js --repair` and verify native dependencies;
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
