# Tooling guard lifetime — 2026-10-28

**UNVALIDATED source**, branch `codex/pr557-audit-repairs-20261012`, Windows x64,
Node 26.12.1:

| Source | Tree | Change |
| --- | --- | --- |
| `59b66d5661176e793d75261039cd4d4c6b6ed069` | `bb820cc7d4e110f7ba5b93707cfa2f4f5b3db914` | Original result/error admission, no unsettled/cancelled retry and actual LSP fallback propagation |
| `37248f67645c8e26fce855e2cbb4cd99cabca525` | `dee53c2456d3f6ec784f6dc1029394d55f9784e5` | Bounded overflow and independent concurrent prerequisites |

The shared tooling retry guard previously retried cancellation and unconfirmed
resource failures, returned successful objects without their resource admission,
and could replace an original failure with a diagnostic getter/logging error.
Ordinary LSP catches could then classify that work as degraded output.

The actual guard now captures original observations before retry/diagnostics,
retains their independent prerequisites and rejects further dispatch while any
remain pending. Replacing the raw observer cannot bypass the original. Backoff
rechecks that original before another attempt; cancellation is never retried.
Confirmed ordinary failures keep the existing retry and breaker semantics.
Independent diagnostic/logging errors preserve original and secondary causes.
Falsey failures retain their exact thrown value. The existing LSP initialize,
interactive methods, cache flush and outer quarantine/desync classification
boundaries require settlement before reporting ordinary fallback. LSP semantic
producer 62 invalidates prior request-admission meaning.

At most 128 captured prerequisite observations are retained. Overflow remains
unconfirmable and blocks recovery rather than dropping unknown work; each current
call still retains its original result/error. Diagnostics count observations,
not unique resources or native handles. This guard grants no physical close,
cleanup/deletion authority or retry of original failed work during settlement.

Sixteen `tooling/providers/tooling-guard-original-lifetime/*` controls are authored,
**unexecuted**: marked/unmarked/marker-only failures, pending successful output,
observer replacement, confirmed ordinary retry, cancellation, exhausted breaker,
falsey failure, diagnostic/logging independence, late observation changes, retry
boundary recheck, concurrent original prerequisites and inventory overflow. Both
`isOpen` and explicit admission stay blocked until originals settle. No tool,
server, compiler, child or native runtime is launched by these inert controls.
Existing actual LSP timeout/quarantine/transport/partial-output fixtures remain.

Format/ESLint, five plus two JavaScript syntax checks, whitespace and zero
shared-module cycles passed at the recorded batches. Inventory regeneration did
not change generated output. No functional fixture, child, native campaign or
benchmark ran. #292 now records partial source implementation: durable shared
provider/workspace/method health, runtime/workspace/policy fingerprints, finite
cooldown, controlled probe and two-process proof still require implementation.
This is not closure of Lua persistence or broader #1267 native qualification.
Current classification: **481 pending / 145 partial / 92 unresolved** of 718
open reports. Source remains local/unpublished; publication gate remains deferred.
