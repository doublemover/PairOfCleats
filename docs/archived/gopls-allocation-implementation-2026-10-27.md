# Gopls allocation admission implementation — 2026-10-27

**DEPRECATED admission behavior — 2026-10-27, PR #572, commit `723f39f1a`:**
the [allocation contract follow-up](provider-allocation-contract-2026-10-27.md)
keeps unmeasured forecasts planning-only. This historical checkpoint's admitting
forecast behavior was too permissive and was neither published nor executed.
The hosted failure attribution, routing and enforced SDK bounds below retain
their source-specific provenance.

**UNVALIDATED implementation:** source `32b7fac5224acae49a85cb7fcaac01c0902bd0e1`,
tree `e1f596e992ed8cb57cdfe16227e1745c2c152acf`, branch
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
No install, download, compiler, native handshake, functional fixture or publication
front gate ran for this source. Static checks alone do not qualify the forecasts.

## Demonstrated earlier blocker

Read-only inspection of [Windows job 121930737805](https://github.com/doublemover/PairOfCleats/actions/runs/40425503163/job/121930737805)
on branch source `f8532f1d2e54597feecf017e3a60d9ae3258762c` found an installation
failure before executable discovery. Its qualification worker reports synthetic
CI merge source `d1b3885e5876bd335fb78aa04d577b445df69d09`; these are distinct
identities, not current-candidate qualification.

The selected Go SDK reported `go1.27.3 windows/amd64`, with `GOTOOLCHAIN=local`
and a verified GOROOT. The gopls installer then returned:

```json
{"id":"gopls","status":"missing-requirement","reason":"storage-estimate-unavailable","storageAdmission":{"writes":null,"state":"deferred-unknown-allocation","source":"unknown-artifact-build-allocation"}}
```

Later discovery reported 332 missing candidates, zero unknown candidates and no
selected executable. That is the expected consequence of an unperformed install,
not evidence of a defective PATH search. The old source's canonical gopls cache
recipe contained no `storageEstimate`, while its installer required one before
prerequisite or child writes. The original hosted failure remains intact.

The [official v0.24.0 release assets](https://github.com/golang/tools/releases/expanded_assets/gopls/v0.24.0)
contain source archives, not a supported prebuilt replacement. This change keeps
the existing source build/version and Go prerequisite; it does not substitute an
unapproved binary or silently switch toolchains.

## Delivered source

- The canonical v0.24.0 cache recipe declares a maintained cold-build forecast
  covering artifacts (1 GiB), scratch (2 GiB), GOPATH (64 MiB), module cache
  (2 GiB) and build cache (2 GiB). The total is 7 GiB plus 64 MiB. This reserves
  estimates, not allocated disk bytes. It is not an enforced native write ceiling.
- Preview/action receipts identify `canonical-build-forecast-v1`, the pinned
  recipe and `measured:false`. They do not portray these amounts as observed
  native peaks. Unknown recipes still fail the existing admission guard.
- Optional SDK acquisition separately declares 672 MiB, derived from the
  existing enforced 512-MiB extraction and 128-MiB download ceilings plus 32 MiB
  metadata. Those ceiling constants now have one shared owner; behavior is
  unchanged. Generic SDK calls lacking a declaration remain blocked.
- The actual Go child storage profile now routes `GOTMPDIR` into run-owned
  scratch. It retains explicit overrides and grants no cleanup authority.
  Windows case variants of the platform default temp path stay the same default,
  rather than becoming false external overrides.
- Installer and qualification recipes share the existing gopls version constant.
  Actual managed child close, storage reservations, original error observations,
  trust, source integrity and SDK selection owners remain in force.

## Deferred qualification

`tooling/install/gopls-allocation-recipe` is authored, not executed. It inspects
the real catalog/selection, binds estimates against every actual Go route,
checks SDK bounds, temp identity/override behavior and preview semantics, and
retains an unknown-recipe no-spawn/no-directory-creation negative.

Existing allocation-admission, managed-child routing/lifetime, installer preview,
SDK identity/pin and LSP qualification controls remain required. Static format,
JavaScript syntax, configuration budget, whitespace and shared-module cycle
analysis passed (zero cycles). These do not prove native cold-build allocation.

#631 remains open for actual Windows cold install, secondary vendor writes,
serial disk-peak observations against these forecasts, selected installed command
discovery, initialize/shutdown/clean exit and separately named consumers. Other
tool recipes and platforms retain their existing independent blockers. A forecast
exceeded in qualification needs correction; it must not be counted as a measured
passing bound. No user cache, global environment/security setting, GUI, elevation,
physical link, WSL instance or dependency/native binary changed in this work.
