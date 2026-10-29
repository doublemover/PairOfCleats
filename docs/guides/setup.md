# Set up the checkout and a target

Run application commands from the PairOfCleats checkout. Every target command
below includes `--repo`; that selects source to index and never authorizes
installing that project's dependencies.

## Prepare the application checkout

Use the exact Node 26.13.0 pin in `.nvmrc` and the current
[native prerequisites](bootstrap-prerequisites.md). The normal application,
tests and benchmarks require verified readiness.

```sh
node tools/setup/preflight.js --json
npm run bootstrap:ci
```

The first command discovers prerequisites and, on Windows, compiles/links the
selected target capability in owned scratch; it does not record readiness.
The second performs the locked
application install, required package patches, native builds/probes and readiness
receipt. `npm run bootstrap` uses dependency resolution and belongs to an
intentional dependency update. It is different from target provisioning with
`node bin/pairofcleats.js bootstrap --repo ...`.

## Review a first-search plan

Prepared checkouts can preview a sparse code-first plan without downloads,
provider execution, file writes or target dependency installation:

<!-- poc:recipe setup-plan shell=portable effects=read-only -->
```sh
node bin/pairofcleats.js setup --repo "path/to/your-project" --plan --profile sparse --backend memory --json
```

Save that JSON to a file with your shell's ordinary UTF-8 redirection, inspect its
application/target roots, minimal config patch, output locations and operations,
then explicitly apply it. Applying preserves comments outside modified fields
and unrelated settings. It rejects a changed target/config/effective policy,
selected runtime or operation plan; generate a fresh plan after any such change.
The preview uses the canonical repository-authority and trusted-policy merge.
A trusted override that defeats a requested choice, or a selected tool without
a qualified recipe, blocks apply before the config is written. Local model asset
presence is reported separately from executable or inference verification.

<!-- poc:recipe setup-apply shell=portable effects=target-config-and-derived-build -->
```sh
node bin/pairofcleats.js setup --repo "path/to/your-project" --apply-plan "setup-plan.json" --json
```

Semantic planning requires `--profile semantic --model <selected-model>`.
`--tools <id,id>` provisions only explicitly selected tools. Review their runtime
requirements, immutable sources, trusted policy and platform blockers first.
Unknown download sizes remain unknown. A requested tool with an unsupported
recipe remains blocked; installed bytes, version output, protocol initialization,
model inference and project qualification are separate evidence.
`tooling install --dry-run` now takes a separate metadata-only source path:
located executables are labeled `located-not-probed`, prerequisite commands are
not executed and recipe environment values are omitted. Unknown allocation or
missing qualified recipes produce visible blockers and a nonzero status; a
preview never reports an installation ready. This new path is **UNVALIDATED**.

## Existing interactive and unattended setup

The existing prompted path remains available for selected optional assets:

<!-- poc:recipe setup-interactive shell=portable effects=selected-provision-and-build -->
```sh
node bin/pairofcleats.js setup --repo "path/to/your-project" --skip-install
```

For unattended use, state omitted work explicitly. This example validates only
and omits optional acquisition/build work:

<!-- poc:recipe setup-unattended shell=portable effects=read-only -->
```sh
node bin/pairofcleats.js setup --repo "path/to/your-project" --non-interactive --validate-config --skip-install --skip-dicts --skip-models --skip-extensions --skip-tooling --skip-artifacts --skip-index --skip-sqlite --json
```

Unattended prompt defaults are choices, not consent inferred from a previous
interactive run. JSON mode emits one final stdout object; prompts, diagnostics
and child progress use stderr. `--require-steps <csv>` makes named prerequisites
required but does not enable a skipped operation. Read the readiness summary:
`ready`, limited/degraded scope and blocked prerequisites mean different things.
A skipped requested capability is not complete.

Guided setup and fast `bootstrap --repo ...` await the shared asynchronous child
owner. `SIGINT` and `SIGTERM` stop later stages and retain exit status `130` and
`143`. JSON mode reports one terminal summary; `lifecycle.state` distinguishes
`cancelled`, `blocked` and `settlement-pending`. An unconfirmed child teardown
stops the run even in an optional step. Keep its resource owners until actual
settlement is established. Target index, SQLite and artifact-restore children
receive the selected repository explicitly, including nested project folders.
These source changes and their inert regressions are **UNVALIDATED**.

Dictionaries download selected supported missing wordlists; models acquire the
selected model; tooling can execute installers; extensions acquire approved
native assets; builds write target cache artifacts. Review each capability's
configuration, trust and storage location before opting in. Guided setup leaves
application and consumer dependency graphs to their explicit owners.

## Validate and search

Follow the [first-search guide](first-search.md) for a bounded code build, selected
mode validation and a query chosen from your project. The plan prints target-
qualified validation/search argument vectors; its example query is a placeholder,
not fabricated proof that your repository contains a symbol.

## Diagnose readiness

Before bootstrap, the dependency-free front door is available:

```sh
node bin/pairofcleats.js checkout diagnose --json
node bin/pairofcleats.js checkout diagnose --prerequisites --json
```

The report names runtime, executable, ABI, physical checkout and individual
receipt mismatch fields. Metadata inspection does not activate native packages.
The required Tree-sitter patch also owns an async Node-API cleanup handle.
On Node 26.12.1, an interrupted parser worker can otherwise drain a queued
finalizer after its environment has been freed. The handle releases through the
supported async cleanup API; parser operations, worker cancellation and strict
callback errors remain enabled. Setup activation is separate from the ten
fresh-process natural/cancelled worker cases in
`tests/tooling/install/native-parser-error-contract.test.js`.

For intact dependencies and patches under the selected runtime,
`node tools/setup/rebuild-native.js --verify` can verify and refresh readiness;
it cannot repair missing patches. Input/lock/patch drift needs locked bootstrap.
Never copy or rewrite receipt identity as a repair.

If a selected provider/model fails, retain its exact path/identity and bounded
stderr. Re-plan after fixing the stated prerequisite. If work is quiet, use
structured progress and owned activity timestamps; elapsed time alone does not
prove a stall. Cancellation/partial results list completed and pending operations.
Inspect active readers/writers before recovery; do not remove locks or entire
cache roots as a generic fix.

The [source-upgrade guide](upgrades.md) covers existing installations. Contributor
scratch conventions belong in [contributing](contributing.md). The
[archived setup account](../archived/setup-2026-10-22.md) preserves dated
node-pty/docx/Perl, scheduler and platform evidence and its limitations. This
reorganization does not claim new native/platform qualification.
