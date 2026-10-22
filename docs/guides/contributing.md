# Contribute with bounded evidence

Start in an authorized checkout. Read `AGENTS.md`, scoped instructions, branch and
Git status, then preserve unrelated work and active indexing processes. Use Node
26.12.1 and verified locked bootstrap before normal test/benchmark entry points.

## Discover, select, run

The current runner discovers convention-based fixtures using `tests/run.rules.jsonc`
and ordered lane inputs. There is no active `tests/manifest.json` alternative.
List an affected intent, then execute its actual discovered ID:

```sh
node tests/run.js --lane all --match tooling/install/checkout-diagnosis-identity --list
node tests/run.js --lane all --match tooling/install/checkout-diagnosis-identity --jobs 1 --timeout-ms 30000 --retries 0
```

A timeout over 30 seconds is a failure to report and diagnose. Retries, skips and
larger deadlines are not passing evidence. Use `tests/helpers/test-env.js` for
test-only overrides and `tests/helpers/test-cache.js` for disposable roots.
Inspect original failures before rerunning affected cases after a fix.

## Run the batch front gate once

After affected checks pass, run the ready-to-publish batch's existing front gate:

```sh
npm run format
npm run config:budget
npm run env:check
node tools/docs/generated-surfaces.js --check-freshness
node tools/ci/check-command-surface.js
node tests/ci/workflow-contract.test.js
node tests/run.js --lane gate --timeout-ms 30000 --retries 0
git diff --check
```

Stop on the failing check, fix its cause and rerun that check. Formatting already
includes ESLint fixes; inspect the diff and stage only owned changes. The gate
lane does not include every preceding command. Platform, Rust, optional-native,
integration, performance and release qualification need their own scoped evidence;
`npm run verify` is much broader and is not the automatic substitute.

## Keep artifacts and claims scoped

Developer fixtures/coverage/bench workspaces use the owned `.tmp/dev/` roots from
`tools/shared/dev-artifacts.js`; task evidence uses `.tmp/tasks/<task>/`.
`.testLogs` and `.diagnostics` retain provenance and original failures. Historical
author-workspace files are not inputs promised in clean checkouts. Never clear
product caches, active indexes or unrelated evidence as a setup shortcut.

See [the runner contract](../testing/test-runner-interface.md),
[qualification classes](../testing/qualification-matrix.md),
[CI policy](ci-gate-policy.md), and
[bounded benchmark workflow](../benchmarks/overview.md). Record exact head, runtime,
platform, command, passed/failed/skipped scope and unrun work. Earlier green runs
are not final-head acceptance. If a development phase explicitly defers validation,
label its source/fixtures **UNVALIDATED** and carry proof forward as pending.
