# Configuration source descriptor and report lifetime

Status: source and authored regressions are **UNVALIDATED**. No executable,
formatter/bootstrap, installer, native or platform qualification has run.

The canonical `loadUserConfig` repository/trusted source reader and
`readShippedConfigSchema` now borrow their actual regular files through the
existing synchronous JSON text descriptor owner. JSONC parsing, content hashing,
schema freezing/identity-cache publication, authority filtering and merges follow
confirmed close. The existing shipped path/stat identity cache is retained;
failed close cannot publish a reusable schema, and confirmed unchanged identity
can still reuse the same frozen schema without another descriptor.

Optional source classification captures original native observations before
reading `code`. Only ordinary confirmed initial `ENOENT` can become missing
configuration. An `ENOENT` carried by a failed close, pending native read or
diagnostic getter cannot become defaults. Report fields record `readState`
`pending`, `failed` or `missing` for incomplete reads; successful metadata keeps
its established `exists`/content-hash shape. Pending input has no completed hash.
The existing source formatter prints pending/failed instead of claiming absence.
This is metadata about the read, not file deletion or trust authority.

`onSources` still receives the canonical loader facts once on success or failure.
The loader captures its original failure before invoking that callback. If the
callback also throws, both original errors and independent native observations
remain, including falsey/frozen values; a report failure cannot replace the
primary. Changing the primary's observer during the callback cannot clear the
captured prerequisite. Ordinary callback-only errors keep their raw identity.
Returned asynchronous callback work is not adopted or described as settled.

Effective-configuration explanation checks original settlement before turning a
failure into a sanitized rejected report, captures diagnostic fields once, and
checks again afterward. Pending descriptor/native ownership propagates as the
actual retained failure. Configuration dump inherits that behavior and cannot
advance to a requested capability probe. Genuine missing/schema/guardrail errors
retain normal rejected-report compatibility and existing authority precedence.

`tests/tooling/config/source-resource-lifetime.test.js` authors actual config,
shipped-schema, effective explanation and dump consumers with original read
guards, close failure carrying misleading `ENOENT`, pending source metadata,
observer replacement, falsey/frozen report composition, failed-close cache
suppression, confirmed schema reuse, no capability probe and genuine optional
missing behavior. Numeric failed-close generation remains unknown even after
disposable fixture cleanup; no receipt is manufactured. Existing source
metadata, schema identity, loader and effective-explanation fixtures remain.

Other JSONC/workspace/diagnostic readers, raw existence probes, atomic publishers,
downstream catch-all callers and cross-process/native/performance acceptance
remain open. This introduces no registry, category/coordinator authority,
trust relaxation, configuration knob or issue-completion claim.
