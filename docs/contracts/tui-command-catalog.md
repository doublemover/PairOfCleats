# Native command catalog

Status: source implementation, unvalidated (2026-10-22).

The existing `workflow:run` protocol owns scope selection, describe, preview,
one-use launch, discard and published-status observations. No form can submit an
arbitrary executable. `tools/tui/operator/index-catalog.js` consumes the command
registry and the actual CLI option objects. Inline definitions needed by both
surfaces now live in `tools/shared/operator-cli-options.js`; the canonical CLIs
import those same objects. This is a definition move, not an additional CLI.

`describeWorkflowCoverage()` is the machine-readable coverage manifest. Every
stable/operator command has either a typed adapter or a concrete unsupported
reason. A new registry command without a disposition fails catalog admission.
Experimental commands are hidden by default; `X` in the native catalog explicitly
enables them for this session. Internal commands remain hidden. Disabling the
experimental catalog also revokes its existing preview tokens.

The catalog adds scoped setup/bootstrap, tooling doctor/detect/install, a loopback
API service, cache GC, context/graph/impact, architecture/test suggestions, risk,
map/evaluation/model-comparison reports and a restricted search microbenchmark.
Request-file semantic/runtime forms consume the existing strict canonical
schemas in their CLI owners. They retain one bounded page; native continuation
within one semantic CLI process is not implemented. The request file must be
within the chosen repository and name that repository as `repoRoot`; file bytes
are bound into the expiring preview. Explicit report output paths must also stay
inside the selected repository, and their observed identity is rechecked before
spawn. This check does not replace a command's own atomic publication authority.

Known report/map/evaluation/microbenchmark output flags also feed the existing
artifact collector. An exact output filename within the selected repository can
receive the existing checksum/identity-verified open, copy and export actions;
changed or out-of-scope files cannot. Web maps remain files and native inspection
does not render their 3-D scene. The native map form excludes serve/browser/TLS
options until a dedicated verified preview adapter exists. Artifact Open uses
the existing trusted editor launcher; it does not claim to open a browser.

Every launch presents exact canonical argv, selected scope, known cache impact,
input/output observations and an effect explanation. Setup always uses the
canonical non-interactive mode. Credential flags, raw environment/command text,
shared cache-root overrides and unauthenticated/non-local API bind options are
not admitted by native forms. Credentials use the existing private trusted
environment or configuration handoff. Setup completion separately observes the
actual bootstrap verifier and runs canonical tooling doctor; failed, missing or
incomplete verification cannot become ready merely because installation exited.

API launch is fixed to `127.0.0.1`, reports the canonical startup output, and uses
the supervisor's exact job/process identity and existing cancellation/shutdown
owner. A running PID does not establish endpoint health. MCP stdio attachment and
multi-repository indexer ownership lack native control-channel adapters and are
explicitly unavailable. Cache GC retains its canonical scope and active-owner
exclusions. Whole-root cache clear, SQLite compaction and LMDB mutation remain
unavailable until their canonical owners provide the required native plan or
exclusive child handoff. The supervisor's process-lifetime reader lease cannot
be upgraded by ignoring itself, and a parent-held exclusion cannot be treated as
permission for an unrelated child to read that cache.

The experimental microbenchmark adapter uses only sparse/dense/hybrid search,
forces build/clean off, and bounds run/warmup counts to ten. Full index/corpus/
backend qualification continues to require its separate explicit CLI plan.

Native fields use the supplied schema for literal strings, numeric JSON, enum
cycling, boolean toggles and bounded string-array item addition; `e` retains an
advanced JSON editor. `false`, `0`, `null` and unset are distinct values. Settings
Delete is an explicit remove operation through the existing schema/revision/
scope-bound preview and atomic commit; it is not a JSON null sentinel.

Authored regression sources cover registry parity, exact argv, experimental
visibility, failed ownership admission, typed values, inert paste and source
identity. None have been executed in this development span. Actual native
keyboard/request/supervisor/result, frame, ConPTY, cancellation and platform
acceptance remain deferred; this document is not a qualification receipt.
