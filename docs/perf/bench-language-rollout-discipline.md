# Bench Language Rollout Discipline

Benchmark hardening work is not done when a single full run looks better. Any change that can affect benchmark truthfulness, lifecycle behavior, artifact publication, timeout policy, scheduler correctness, or native crash handling must land with a rollout artifact that proves the change was reproduced, constrained, compared, and cut over cleanly.

## Definition Of Done

- Record a targeted reproduction or replay path for the failure class before broad refactors begin.
- Record at least one focused contract test for the surface being changed before relying on full-corpus validation.
- Record a control-slice before/after pair and compute the delta for failed repos, retained crash bundles, core timing, and degradation counts.
- Record a full-corpus before/after pair and compute the same delta set.
- Record any temporary policy switches used during validation and remove them before closeout.
- Record hard-cutover cleanup and confirm compatibility paths were removed in the same change stream.
- Validate the rollout artifact with `tools/ci/bench-language-rollout-gate.js`.

## Owner Matrix

- `publication-correctness`: `bench-publication`
- `lifecycle`: `bench-lifecycle`
- `timeout-policy`: `bench-timeout-policy`
- `scheduler-correctness`: `bench-scheduler`
- `native-crash-handling`: `bench-native-crash`

These owner ids are maintenance surfaces, not temporary assignees. A rollout artifact should attach each changed fix area to one of these owners or to a more specific owner nested under the same surface.

## Rollout Plan Shape

Each rollout plan must declare one or more `fixAreas`. Every fix area must include:

- `id`
- `title`
- `owner`
- `reproduction`
- `contracts`
- `controlSlice.beforeReport`
- `controlSlice.afterReport`
- `fullCorpus.beforeReport`
- `fullCorpus.afterReport`
- `cutover.hardCutover`
- `cutover.compatibilityPathsRemoved`

Optional temporary policy switches are allowed only as validation-only scaffolding and must be removed before closeout.

## Gate Command

```powershell
node .\tools\ci\bench-language-rollout-gate.js `
  --plan .\benchmarks\results\logs\bench-language\artifact-publication-rollout.json `
  --json .\benchmarks\results\logs\bench-language\artifact-publication-rollout-gate.json `
  --enforce
```

The gate reads the rollout plan, loads the referenced control-slice and full-corpus reports, computes before/after diffs, and fails when required rollout evidence is missing.
