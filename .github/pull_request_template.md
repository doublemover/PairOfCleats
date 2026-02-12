## Summary

## USR Change Control

<!-- usr-policy:change-control -->
- [ ] If this PR changes behavior, I linked impacted sections in `docs/specs/unified-syntax-representation.md` and the decomposed map in `docs/specs/usr/README.md`.
<!-- usr-policy:decomposed-workflow -->
- [ ] If this PR changes USR docs/contracts, I updated `docs/specs/usr-consolidation-coverage-matrix.md` and aligned roadmap references.
<!-- usr-policy:registry-drift -->
- [ ] If this PR changes language/framework registries, I updated corresponding `docs/specs/usr/languages/*.md` or `docs/specs/usr/frameworks/*.md` contracts.
<!-- usr-policy:parser-lock -->
- [ ] If this PR changes parser/runtime versions, I updated `tests/lang/matrix/usr-parser-runtime-lock.json` and included impact + fallback evidence.
<!-- usr-policy:runtime-config -->
- [ ] If this PR changes runtime keys or feature flags, I updated `tests/lang/matrix/usr-runtime-config-policy.json` and conflict/precedence evidence.
<!-- usr-policy:failure-injection -->
- [ ] If this PR adds or changes blocking fault classes, I updated `tests/lang/matrix/usr-failure-injection-matrix.json` and recovery evidence.
<!-- usr-policy:benchmark-slo -->
- [ ] If this PR changes benchmark lanes/SLO thresholds, I updated `tests/lang/matrix/usr-benchmark-policy.json` and `tests/lang/matrix/usr-slo-budgets.json`.
<!-- usr-policy:threat-model -->
- [ ] If this PR changes security gates or attack surfaces, I updated `tests/lang/matrix/usr-threat-model-matrix.json` and `tests/lang/matrix/usr-security-gates.json`.
<!-- usr-policy:waiver-governance -->
- [ ] If this PR changes waiver behavior, I updated `tests/lang/matrix/usr-waiver-policy.json` and documented expiry review cadence.

## General Checklist

- [ ] no mistakes
