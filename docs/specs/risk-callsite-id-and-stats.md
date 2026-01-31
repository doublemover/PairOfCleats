# Spec: callSiteId algorithm (v1.1 refined)

## Status
* **Normative** for Phase 10 implementation.
* Uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) for requirements.

## 1) Scope
This document defines the deterministic `callSiteId` algorithm used by `call_sites` rows.

The `risk_interprocedural_stats` artifact is defined in:
* `docs/specs/risk-interprocedural-stats.md`

## 2) `callSiteId` algorithm (normative)

`callSiteId` MUST be computed as:

```
callSiteId = "sha1:" + sha1(
  file + ":" +
  startLine + ":" + startCol + ":" +
  endLine + ":" + endCol + ":" +
  calleeRaw
)
```

Constraints:
* `file` MUST be the repo-relative POSIX path for the call site location.
* Line/col MUST be **1-based**.
* `calleeRaw` MUST be the raw callee string recorded by the language relations collector.
* If `endLine`/`endCol` are not available, set them equal to `startLine`/`startCol`.
* The SHA1 hex MUST be lowercase, prefixed with `sha1:`.

Notes:
* `callSiteId` is referenced by `risk_flows.path.callSiteIdsByStep` and MUST be stable across repeated identical builds.
* If required input fields are unavailable, the producer MUST NOT synthesize a `callSiteId` from alternate fields; instead, it MUST omit the call-site row or correct the collector to provide the required fields.

## 3) Implementation mapping
- Call-site writer: `src/index/build/artifacts/writers/call-sites.js`
- Call-site schema: `src/contracts/schemas/artifacts.js` (`callSiteEntry`)
- Required keys: `src/shared/artifact-io/jsonl.js` (`JSONL_REQUIRED_KEYS.call_sites`)
