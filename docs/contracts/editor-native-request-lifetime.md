# Editor native request lifetime

VS Code definitions and references capture the requesting document version,
local file URI, saved/closed state, cursor and declaration policy before awaiting
repository selection. Repository lookup cannot replace the buffer which admitted
the spelling query. The original cursor and policy remain immutable throughout
CLI dispatch and result handling.

Saved-source arguments establish the first qualified source hash and coordinates
under the selected repository. Later admission must reproduce that request's
arguments and repository. After the CLI returns, every target still uses the
existing opened-document byte, URI, buffer/version and final-publication checks.
Opening targets introduces further awaits: before returning native locations,
the provider checks the original requesting document and saved source again.
A changed/dirty/closed source, changed local URI or replaced saved bytes discards
those locations even when all target documents remain unchanged.

Completion and document-symbol providers also retain their original requesting
document version/URI/state across repository lookup and CLI execution. Their
existing approximate/indexed result semantics remain unchanged; this lifetime
fence does not promote spelling candidates or document-symbol rows to uniquely
bound semantic evidence. Existing cancellation and child ownership remain with
the extension operation owner.

The additional registered-provider and pure request controls are authored and
**UNVALIDATED**. No test, syntax/lint/format, bootstrap, native/child execution or
VS Code host qualification was run. File reads provide observed consistency,
not an atomic filesystem snapshot. This source work does not establish generated
source mapping, complete semantic producer coverage, host cancellation behavior,
native teardown, resource bounds or performance acceptance.
