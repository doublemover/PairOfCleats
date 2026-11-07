# Provider allocation contract follow-up — 2026-10-27

**UNVALIDATED implementation:** source `723f39f1acb49c4e8b88e3335e5b829fdd220429`,
tree `01e56c7efcdfb975c35d1dbc848ef5ead031d126`, branch
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
This supersedes the admitting-forecast behavior of local checkpoint `32b7fac52`.
Neither checkpoint has been published or used for an actual installation.

## Current behavior

The single allocation classifier now lives in the dependency-light
`install-allocation-contract.js`. Canonical registry normalization, preview,
installation and first-search planning use the same classification. Every
selectable cache recipe without admitted bounds gets a product-owned blocker
and a corrective action; it is not presented as ready to apply or as an executable
the user can restore by repeatedly running discovery.

Gopls's unmeasured forecasts are planning data only: `writes:null`, bounded
`forecastWrites`, and `deferred-unqualified-build-allocation`. Setting arbitrary
`complete` or `qualified` booleans cannot promote that basis into admission.
Pure destination projection can inspect route coverage without creating a write
reservation. The real admission binder rejects the forecast. Supported bounded
archive owners keep their existing admitted path; unknown recipes remain blocked
and compatible executable reuse remains independent of acquisition.

First-search approval identity now includes both the extracted allocation owner
and gopls recipe module. A changed allowance/version cannot reuse a plan whose
fixed source inventory omitted its new owner. Error codes remain unchanged;
diagnostics name the missing product contract and next action.

The earlier `GOTMPDIR` routing, Windows temp-identity fix and shared SDK archive
ceilings remain. Separately, source `230b94dc4fb9c4b5c05e891f0cd836bd9ef7794d`
makes standalone LSP handshake discovery use the existing scoped managed-command
selector. Its authored control removes PATH access, compares profile/handshake
selection and retains explicit missing-path rejection. This is a separate source
gap, not the cause of the earlier hosted unperformed gopls installation.

## Authored coverage and remaining work

The gopls fixture now checks the entire actual cache-recipe registry: each selected
recipe has admitted bounds or an explicit non-installable allocation reason. It
checks planning-only forecasts, boolean-promotion rejection, every actual Go
route, uncovered external overrides, SDK bounds, Windows temp identity, blocked
preview and the unknown-recipe no-spawn/no-directory-creation control. Existing
archive and managed-child negatives remain. These and the extended actual
profile/handshake fixture have **not run**.

Format, JavaScript syntax, configuration budget, whitespace and shared-module
cycle analysis passed (zero cycles). No project functional fixture, native tool
install, compiler build, download or publication front gate ran for this source.

#1559 and #631 remain open. Exact package/dependency closure and qualified
recipe-specific build allowances still need owners for fresh package-manager
installs. Nested archive wrappers need one allocation owner without duplicate
charging. Cold Windows tool execution must record actual destination/write/peak
observations and installed-command/protocol/consumer outcomes. The earlier hosted
failure and its [root-cause receipt](gopls-allocation-implementation-2026-10-27.md)
are preserved. Forecasts do not close that installation blocker. No scope fallback,
eviction, user-cache cleanup, elevation, WSL, physical link, GUI or global/security
setting changed.
