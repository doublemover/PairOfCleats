# Shared workspace/method health — 2026-10-28

**UNVALIDATED source**, branch `codex/pr557-audit-repairs-20261012`, Windows x64,
Node 26.12.1:

| Source | Tree | Change |
| --- | --- | --- |
| `1cddb7e1fcb9e3b2522ff02b040350c8b1363f6b` | `c96a1a5b667964c73b97a290904874b9b2721886` | Shared durable method admission and actual configured LSP integration |
| `3100f10da9c4fcee101c5529434340c3f1e0e3e6` | `385a64477d5ee945426560f28abb3548ce1a3d87` | Strict foreign/future cache rejection and exact cooldown/serialized bounds |

Lua already had serial symbol/hover requests, a one-timeout hover cutoff,
adaptive scope and same-process session quarantine. The remaining defect was
cross-process loss of known-bad workspace/method admission. Output/request-result
caches did not persist that decision.

Actual configured LSP collection now loads bounded shared health before request
admission. Observed runtime/source/configuration/policy context selects per-method
state under existing tooling-cache atomic persistence and resource-settlement
file locks. A healthy method/root can contribute while hover is deferred.
Eight context variants, fifteen methods and 256 KiB bound each workspace store.
Unknown identity, corrupt/foreign cache and inconsistent/future method timestamps
cannot manufacture durable admission. Records retain only bounded hashes/state,
not source or environment plaintext.

Timeout, transport and malformed response are separately attributed. Known
settled method failure uses method cooldown rather than a duplicate provider trip;
protocol/transport corruption retains session poisoning. Opaque original decisions
prevent server lookalikes from bypassing counting. Native pending work blocks
classification/persistence first. Shared 15/60-second defaults retain existing
test-hook ownership. Healthy success clears failure; expired state permits one
controlled method probe. Persistence failure retains original and secondary causes
without replay. Counters distinguish actual fresh callback attempts/suppression
from withheld retry allowance. LSP producer 64 invalidates earlier admission.

Source policy inventory preserves Lua serial admission, one-timeout cutoff and
existing adaptive document/target/value limits. No representative request-mix,
latency or RSS distribution was measured. This is observed advisory health, not
complete interpreter/SDK/dependency closure or native binary-content provenance.
Dedicated providers keep their existing health implementation.

Twenty-nine `tooling/lsp/workspace-method-health/*` cases are authored,
**unexecuted**: fresh-process failure/reuse, actual collector contribution across
processes and pooled same-process reuse, competing recovery, source/config/runtime/
policy/root changes, method independence, timeout/transport/protocol/payload classes,
corrupt/foreign/future-state preservation, clock bounds, unknown identity, original
pending/settled work, ordinary retry, healthy reset, variant bounds, negative
configuration, cancellation, independent write failure and spoofed decisions.
Inert clients launch no language server; the fresh-process cases will run bounded
Node fixtures when executed later. Failed/unsettled roots remain preserved.
Existing real Lua quarantine, request/cache/adaptive and native disposal assertions
remain required.

Format/ESLint, twelve plus three JavaScript syntax checks, whitespace and zero
shared-module cycles passed. Inventory regeneration did not change output.
ESLint found two test-hook fallback constant names during policy extraction;
both were corrected before the successful final pass. No functional fixture,
child, server, native campaign or benchmark ran. #292 moves from partial source
to **qualification pending**; no issue closes. Current Windows small/medium
reproductions and original/follow-up cases must qualify default identity reuse,
partial contribution, expected diagnostics and serial resource/performance behavior.
Counts: **482 pending / 144 partial / 92 unresolved** of 718 open reports.
Source remains local/unpublished; publication gate remains deferred.
