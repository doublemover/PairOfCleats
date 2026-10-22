# Node runtime policy

Reconciled with the checked-in package, bootstrap guard and workflows on
2026-10-21. Selected versions do not imply every platform has passed validation.

## Application runtime

For an existing indexed checkout, follow [source upgrades](upgrades.md) before
changing runtime/dependencies or rebuilding derived artifacts.

- `package.json` and the lockfile require **Node >=26.12.1 <27**. The bootstrap
  readiness guard enforces that minimum; older Node releases cannot run this
  checkout normally.
- `.nvmrc`, CI, nightly, CI Long, maintenance and release jobs pin **26.12.1**.
  Keep native `node_modules` cache keys aligned with that version, OS,
  architecture, lockfile and patch set. The workflow contract reads `.nvmrc`
  and checks every Node pin and native-cache version.
- Node 26.8.1 has a confirmed worker teardown use-after-free in the cppgc
  `ContextifyScript`/`Realm` lifecycle. A CDB dump from the original Windows
  compiler fixture matched [Node's fix](https://github.com/nodejs/node/pull/65778),
  released in [26.10.0](https://nodejs.org/en/blog/release/v26.10.0). The
  [Windows repair receipt](../archived/windows-deep-repairs-2026-10-18.md)
  separates that crash attribution from final suite acceptance.
- The patched Tree-sitter 0.25.0 binding also handles exceptions during owned
  worker termination. This fixes a separately captured `0xC0000409` fatal exit
  on Node 26.10.0; the Node pin alone does not supply that repair. Ordinary
  callback, language and range errors remain strict. The
  [parser repair receipt](../archived/github-issue-repairs-2026-10-20.md#batch-64-real-parser-state-and-interrupted-native-worker-lifetime)
  records the exception, original installation and fresh-process controls.
- Run `npm run bootstrap:ci` after checkout setup or dependency/runtime changes.
  It installs the lockfile graph including development dependencies, applies
  required patches, rebuilds/verifies native modules and records readiness.
  Reserve `npm run bootstrap` for intentional dependency-resolution changes.
- Prepared dependencies may use `node tools/setup/rebuild-native.js --verify`
  to refresh readiness after successful native and patch verification. This
  verification cannot repair missing patches. Do not share native modules
  across Node versions or bypass a missing/stale readiness receipt.

The [October 5 policy](../archived/node-runtime-policy-2026-10-05.md) records
the superseded Node 24 baseline and earlier action migration. The
[macOS comparison proposal](../benchmarks/node-runtime-comparison.md) remains
historical and unexecuted; its Node 24 arm cannot run unchanged against the
current Node 26 bootstrap guard. A future comparison needs its own compatible
source revision, task scope and matched measurements.

## GitHub Actions runtime

An action's own interpreter is separate from the application runtime installed
by `setup-node`. The checked-in workflows currently select:

| Action | Selected major |
| --- | --- |
| checkout | v7 |
| setup-node | v7 |
| cache | v6 |
| upload-artifact | v7 |
| download-artifact | v8 |
| github-script | v9 |
| attest-build-provenance | v4 |
| github/codeql-action | v4 |

Adaptive-policy workflows pin reviewed checkout and github-script commits;
the workflow contract checks those exact refs separately. Rust remains pinned
to 1.88.0. The github-script contract compiles scripts against the injected
v9 parameters and rejects the removed CommonJS import of `@actions/github`.

Review action upgrades against their own manifests, API changes and runner
requirements. Changing the application's Node pin does not by itself establish
action-runtime compatibility. The workflow, dependency-security, install-policy
and native activation checks remain separate acceptance surfaces.

CI runs `npm audit --audit-level=low` against current advisories. A runtime or
offline dependency contract pass does not establish a clean live audit or
hosted CI acceptance. Record the tested revision and environment for each.
