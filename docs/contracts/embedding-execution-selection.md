# Embedding selection and late binding

Current source and authored fixtures are unvalidated.

The ordinary full-build parent captures an immutable version-2 execution plan
before Stage2; explicit Stage3 captures at its entry. It includes selected model,
provider, normalization, ONNX settings, environment/resource requests and source
facts. Real enabled model profiles validate before selection completes. Named
profile defaults (revision, precision and dimensions) become explicit selected
values; later code/default changes cannot choose them again. Incompatible model
dimensions fail through the existing shared dense/profile contract. Disabled and
stub lanes do not require real-model profile validation or assets.

After Stage2, `bindEmbeddingExecutionPlan` may fill the generated build identity
and absolute index root, and narrow modes. It never re-runs environment/config/
model selection or changes `selectedAt`. Existing bound roots/build identities
cannot change; modes cannot widen; unknown binding keys fail. Digest, field,
redaction and 32 KiB handoff validation remain. Capture deep-clones/freezes bounded
plain selection data; caller mutations cannot alter the captured values.

Inline and queued Stage3 launches share that selection and bind their actual
scope through the same owner. Direct Stage3 callers without a parent plan select
once before lock waits and per-mode launches. Pinned enabled/stub/mode intent must
match execution. Existing observability/queue/attempt owners still carry the
resulting plan; no separate authoritative store or artifact-format relaxation was
added. A plan is a selected request, not permission to delete assets or a runtime
readiness receipt.

This does not finish #1325. Read-only selected-asset/native availability states,
authorized fetch versus cache-only handling, preflight attempt persistence,
watch/two-stage/recovery adoption and actual zero-parser/child qualification
remain. No download, model load/probe/inference or functional fixture ran here.
Six new late-binding/profile/inactive cases and the strengthened actual inline/
queue handoff fixture are authored, unexecuted. Its scope spelling uses an
existing directory plus `.` rather than creating a symlink/junction. Physical
link equivalence remains separate workspace identity qualification.
