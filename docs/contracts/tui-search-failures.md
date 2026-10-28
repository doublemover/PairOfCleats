# Native search failures

Successful retrieval diagnostics describe an admitted result page. Operation
failures instead use `src/contracts/tui-operation-failures.json` and
`TUI_OPERATION_FAILURE_SCHEMA`: version, closed reason/outcome, optional closed
field, opaque `tui-UUID` and the matching bounded actions. Explanations come from
the catalog. Rust uses generated definitions rather than arbitrary response text.

The child bridge accepts only complete bounded JSON failure envelopes with known
codes. Truncated/lossy capture and human stderr do not own a typed cause. Original
exceptions, inspection failures and cleanup observations remain private and
authoritative. Unexpected native exit classification is diagnostic information,
not crash attribution.

The canonical search runner prepares successful output before closing its
backends and emits it only after request settlement. A cleanup failure keeps the
request failed; original work and cleanup remain independently observable.
See the [search publication owner](../archived/search-publication-settlement-implementation-2026-10-28.md).

Search failures and fresh admission rejections carry `error.failure` on the
existing terminal event. Rejection never replaces an accepted job ID.
`search:run` methods `status` and `readiness` accept empty records: status observes
original pending resources; readiness observes bootstrap metadata and explicitly
records that native probes did not run. Neither executes recovery. Pending owners
keep retry unavailable until original release and explicit user action.

The native model separates running, failure, cancellation, timeout, pending
resources, successful-empty and successful-results. Only admitted success can
show empty-result wording. A failed continuation labels its previous page.
Query/repository drafts and request context remain volatile; scope changes
invalidate old recovery context.

Closed recovery keys: `e` edit, `d` failure detail, `r` explicitly retry an eligible
original request, `t` observe cleanup, `i`/`p` select original-repository
`index.validate`/`tooling.doctor` forms, `s` inspect setup metadata. Preview and
launch retain existing confirmations. Navigation cannot replace outstanding
workflow owners. Viewing an error never installs, rebuilds, switches backend,
relaxes authority or executes response-provided commands.

Regenerate Rust with `node tools/tui/generate-search-failures.js`; the generated
surface registry detects drift. See the [implementation and deferred checks](../archived/tui-search-failure-implementation-2026-10-28.md).
