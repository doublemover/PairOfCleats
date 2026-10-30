# Upgrade an indexed source checkout

Use this runbook for an existing installation. Initial installation is covered by
[setup](setup.md); storage relocation is a separate workflow under the
[storage contract](../contracts/storage-layout.md). An artifact-format rebuild
must not be disguised as moving or relabeling old bytes.

## Record the current selection

Before changing code, record the application revision (`git rev-parse HEAD`),
`node --version`, executing Node path, target root/config and
`config dump --repo <target> --json`. Inspect selected mode/generation and backend
status. Retain project config, snapshots, triage/history and failure evidence.
Coordinate active writers/readers before selective repair; do not delete locks,
SQLite sidecars or whole cache roots as an upgrade shortcut.

## Update checkout dependencies under the intended runtime

Select the current `.nvmrc` pin, now Node 26.13.0. Review/update the authorized
checkout through your normal Git workflow while preserving local changes. Run
`npm run bootstrap:ci` from that application checkout after lock, patch, setup,
runtime/ABI or native-artifact changes. It does not install target project
dependencies. A copied `node_modules` directory, old ready flag or prior success
message does not prove current readiness.

For intact dependencies and patches, explicit
`node tools/setup/rebuild-native.js --verify` verifies native activation and
patches before saving a fresh receipt under that runtime. It cannot repair
missing patches. `checkout diagnose --json` names precise identity/input drift;
follow its qualified repair instead of editing receipt fields.

## Reconcile config and derived representations

<!-- poc:recipe upgrade-config shell=portable effects=read-only -->
```sh
node bin/pairofcleats.js config validate --repo "path/to/your-project" --effective --json
node bin/pairofcleats.js index validate --repo "path/to/your-project" --mode code
```

Review effective source layers, ignored authority paths and deprecations before
building. Preserve project-specific settings; no wholesale template overwrite is
required. Compatibility follows selected source/build generations, artifact surface
versions, parser/semantic versions and model/provider identities.

| Observation | Qualified next action |
| --- | --- |
| Compatible selected generation and representation | Reuse it; confirm with selected-mode validation and a known query |
| Missing/incompatible MinHash `hashIdentity` | Rebuild derived artifacts with current source; never relabel old signatures |
| Model/provider/dimensions/precision mismatch | Acquire only explicitly chosen missing assets and recompute affected vectors/ANN representations |
| Missing/incompatible SQLite or LMDB representation | Rebuild that representation using its current build owner against the selected compatible generation |
| Storage root changed | Use the separate supported migration/relocation plan; a path move cannot repair semantic identity |

Use [backend recipes](external-backends.md) and [embedding identity](embeddings.md)
for exact representation boundaries. `index build --repo <target> --mode code`
is the current build route; there is no `sqlite build` wrapper route. Review
whether the needed selective repair exists before execution. An unsupported
selective operation needs its owning implementation, not an imagined command.

## Verify and preserve rollback choices

Validate each requested mode/backend, then search a known term from that target.
Dense work needs explicit provider/model availability and compute/download scope;
compatible models should not be redownloaded gratuitously. Sparse search can
remain useful when its selected generation is valid and dense readiness is blocked.
A completed stage or installed model is not full selected-generation readiness.

Retain the prior source/runtime/dependencies and compatible artifact generation
when rollback is supported. Checking out old source does not make new-format
stores readable. Keep forensic evidence and pinned snapshots; recovery may require
a fresh derived build rather than reverse migration.

The compatible-update, stale-bootstrap, MinHash hard-cut and embedding/backend
mismatch acceptance fixtures remain **UNVALIDATED** in this development batch.
No real user's installation was upgraded or data moved by authoring this guide.
