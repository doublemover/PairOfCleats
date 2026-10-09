# CodeQL alert review — 2026-10-09

Reviewed the twelve open PairOfCleats alerts against PR #547 at
`da25fa1790e1e6cc4e3b669ce839d8a99837e612`. All most-recent alert instances
reported `refs/heads/main` at `fa29bebe8cf2e1f23ac04ddcb9f1d4d3d000c8a5`;
that is not analysis of this PR head. The open Dependabot query returned no findings.

The owner explicitly authorized dismissing verified non-security hashing and
randomness findings. Hash algorithms and cache identities remain unchanged.
No finding was dismissed merely because it remained visible on main.

| Alert | Actual source/use | PR status and action |
| --- | --- | --- |
| [71](https://github.com/doublemover/PairOfCleats/security/code-scanning/71) | `tests/ci/codeql-workflow-contract.test.js`: partial regex escaping of Rust pin | Fixed with the existing complete `escapeRegex` literal encoder; backslash/metacharacter regression assertions added. Pin was already constrained to numeric semver. |
| [70](https://github.com/doublemover/PairOfCleats/security/code-scanning/70) | `tools/dict-utils/config.js`: effective config fingerprint for build/cache identity and provenance freshness | Owner-authorized false-positive dismissal confirmed. No encryption, password storage or authentication; execution authority is checked separately. |
| [69](https://github.com/doublemover/PairOfCleats/security/code-scanning/69) | `tools/bench/embeddings/model-bakeoff.js`: public model ID cache-directory slug | Owner-authorized false-positive dismissal confirmed. No downloaded-artifact verification or secret protection. |
| [68](https://github.com/doublemover/PairOfCleats/security/code-scanning/68) | `tests/shared/cache/cache-key-memo-string-budget.test.js`: independent digest expectation | Owner-authorized used-in-tests dismissal confirmed. Validates cache output on hits, eviction and oversized misses. |
| [67](https://github.com/doublemover/PairOfCleats/security/code-scanning/67) | `src/shared/repo-paths.js`: canonical repository path cache namespace | Owner-authorized false-positive dismissal confirmed. Trust uses exact approved canonical paths in `config-authority.js`, not this digest. |
| [66](https://github.com/doublemover/PairOfCleats/security/code-scanning/66) | `src/index/tooling/preflight/workspace-command-preflight-cache.js`: command/args/watched-file cache invalidation | Owner-authorized false-positive dismissal confirmed. Cache fingerprint does not grant execution authority; providers independently check current authority and guarded cache paths. |
| [65](https://github.com/doublemover/PairOfCleats/security/code-scanning/65) | `src/index/tooling/preflight/manager-state.js`: internal subprocess tracking/cancellation group | Owner-authorized false-positive dismissal confirmed. Label is not an authentication capability; actual tracked children and independent repository authority govern work. |
| [64](https://github.com/doublemover/PairOfCleats/security/code-scanning/64) | `src/index/build/import-resolution/lookup.js`: sorted filename cache fingerprint | Owner-authorized false-positive dismissal confirmed. No artifact authenticity or security authority decision. |
| [62](https://github.com/doublemover/PairOfCleats/security/code-scanning/62) | Sink `tests/helpers/execution-authority.js`; alert's linked random source is `tests/helpers/test-cache.js` | Sink already uses the explicit canonical fixture path. Randomness remains only a test-directory uniqueness suffix alongside PID/time, not a security token. Owner-authorized used-in-tests dismissal confirmed. |
| [61](https://github.com/doublemover/PairOfCleats/security/code-scanning/61) | `tests/ci/workflow-contract.test.js`: partial regex escaping of Rust pin | Fixed with complete `escapeRegex`; workflow contract passes. |
| [60](https://github.com/doublemover/PairOfCleats/security/code-scanning/60) | `tests/ci/workflow-contract.test.js`: partial regex escaping of Node pin | Fixed with complete `escapeRegex`; workflow contract passes. Node pin already required exact numeric Node 24 semver. |
| [59](https://github.com/doublemover/PairOfCleats/security/code-scanning/59) | `src/shared/type-normalization.js`: replacing lowercase boolean with itself | Removed no-op; regression verifies lowercase preservation and boxed Boolean normalization for JS/TS/JSX/TSX. |

## Verification and limits

Passed the individual `codeql-workflow-contract`, `workflow-contract` and
`shared/type-normalization` scripts with existing Node 26.8.1, scoped ESLint
formatting and `git diff --check`. No full suite, benchmark, indexing or GPU run.

GitHub confirmed eight specific dismissals. Alerts 59, 60, 61 and 71 remain open
on main until the corresponding code is analyzed there. Their source fixes are
in this PR; this report does not claim a new CodeQL analysis has confirmed them.
Raw pre/post API evidence and dismissal confirmations are preserved under
`temp/tasks/security-alerts-20261009` in the operator checkout.
