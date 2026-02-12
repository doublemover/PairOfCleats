# USR Framework Contract: react

Status: Draft v1.0
Last updated: 2026-02-12T06:15:48Z
Owner role: usr-framework
Backup owner role: usr-architecture
Review cadence days: 90
Last reviewed: 2026-02-12T06:15:48Z
Rotation policy: rotate primary reviewer assignment between owner and backup every review cycle.

## 0. Scope

Normative framework contract for `react` under USR.

## 1. Detection and precedence

- `detectionPrecedence`: `config-override`, `jsx-tsx-signals`, `jsx-runtime-signals`, `package-signatures`, `heuristic`
- `appliesToLanguages`: `javascript`, `typescript`

## 2. Segmentation and extraction rules

- `blocks`: `script`, `template`, `style`, `route`
- `ordering`: `container-segmentation`, `virtual-documents`, `parse-blocks`, `emit-local-entities`, `emit-bridge-edges`, `route-style-hydration-enrichment`
- `crossBlockLinking`: `jsx-prop-binding`, `router-component-binding`

## 3. Template/binding semantics

- `requiredEdgeKinds`: `hydration_boundary`, `route_maps_to`, `style_scopes`, `template_binds`, `template_emits`
- `requiredAttrs.hydration_boundary`: `runtimeSide`
- `requiredAttrs.route_maps_to`: `routePattern`, `runtimeSide`
- `requiredAttrs.style_scopes`: `scopeKind`
- `requiredAttrs.template_binds`: `bindingKind`
- `requiredAttrs.template_emits`: `eventKind`

## 4. Route semantics

- `enabled`: `true`
- `patternCanon`: `bracket-form`
- `runtimeSides`: `client`, `server`, `universal`, `unknown`

## 5. Style semantics

- `styleEdgeRequired`: `true`
- `styleScopeEdgeKind`: `style_scopes`

## 6. SSR/CSR/hydration boundaries

- `hydrationRequired`: `true`
- `boundarySignals`: `createRoot`, `hydrateRoot`, `server-render-boundary`
- `ssrCsrModes`: `csr`, `hybrid`, `ssr`

## 7. Risk and diagnostics expectations

- emit deterministic diagnostics for unsupported/partial framework semantics
- preserve route/template/style/hydration capability outcomes under strict mode
- map framework-specific degradation to canonical USR diagnostic/reason-code classes

## 8. Required fixtures and evidence

- `edgeCaseCaseIds`: `react-css-module-scope`, `react-hydration-boundary`, `react-route-dynamic`
- `blockingFixtureIds`: `react::framework-overlay::baseline-001`
- `requiredConformance`: `C4`

## 9. Approval checklist

- [ ] Owner-role review completed.
- [ ] Backup-owner review completed.
- [ ] Matrix linkage verified against framework profile and edge-case registries.
- [ ] Required framework fixture families assigned with concrete fixture IDs.
- [ ] Required C4 conformance checks mapped to executable lanes.

## 10. Completion evidence artifacts

- `usr-conformance-summary.json` framework row updated for this profile.
- `usr-quality-evaluation-results.json` includes framework conformance evidence.
- `usr-validation-report.json` strict validation output captures framework fixture scope.
- `usr-drift-report.json` confirms framework-contract and matrix synchronization.
