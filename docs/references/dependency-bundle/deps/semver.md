# `semver`

**Area:** Version parsing and range evaluation

## Why this matters for PairOfCleats
Interpret dependency versions and constraints consistently with npm/semver rules for metadata extraction and reports.

## Implementation notes (practical)
- Use `satisfies`, `coerce`, and range parsing to normalize messy versions.
- Know ordering rules for prerelease tags if you rank/compare versions.

## Where it typically plugs into PairOfCleats
- Index metadata: capture dependency graphs (package.json) with normalized version/range fields.

## Deep links (implementation-relevant)
1. npm SemVer functions + range syntax (satisfies/coerce; npm semantics) — https://docs.npmjs.com/cli/v6/using-npm/semver
2. SemVer 2.0.0 spec (baseline rules; prerelease ordering) — https://semver.org/
3. node-semver README: ranges (caret/tilde/hyphen; set operations) — https://github.com/npm/node-semver#ranges

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).