# Original resolved reranker policy binding

The existing programmatic rerank-pool policy is captured as own passive data.
Accessors, inherited fields, unsupported symbol/nonenumerable names and invalid
explicit enabled values cannot activate a pool. Existing candidate/pool/output/
deadline domains and valid-input policy hashes remain unchanged. One original
adapter identity snapshot supplies both validation and hashing.

The actual live pipeline retains that privately resolved policy producer and
passes it to the existing evidence consumer. Before starting model work, the
consumer compares its captured original adapter object/callback, model and
formatting identities, label and score bounds with the original resolution. It
also checks the original policy key, pool bound, output cap and deadline. A
changed adapter, a sibling object, copied policy fields or a mismatched request
cannot silently use an earlier pinned policy, even with fallback enabled.
These are admission failures before model work; they do not invent fallback
quality evidence or retry a changed model. Disabled policies and legacy direct
consumer calls retain their existing unpinned behavior.

This adds no public CLI/config knob, model/revision/license pin, default model,
quality claim, ranking rule or policy promotion. The private resolved-policy
argument joins the existing live producer and consumer; metadata on a copied
object does not supply that producer identity. Actual model artifacts and
independent source/judgment qualification remain separate prerequisites.

Actual policy/evidence/live pipeline controls are authored but **UNVALIDATED**.
No tests, syntax/lint/format, bootstrap, model/native/child/IPC, editor/browser/GPU,
build or benchmark execution occurred. Runtime compatibility, quality gains,
resource/latency/performance and publication acceptance remain separately scoped.
