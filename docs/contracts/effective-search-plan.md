# Effective search plan ownership

Ranked federation cache keys include a canonical effective query-policy identity
for every admitted repository and pinned mode plan. The index/workspace generation
fence remains separate. Changing one member's relation/graph ranking, blending,
ANN, context expansion or other consumed retrieval policy invalidates outer
reuse even when index artifacts and explicit request arguments are unchanged.
The federated producer namespace is 10.

The existing CLI normalizer applies flag, repository/user configuration and
environment/policy precedence. The identity owner uses the existing runtime config
projection, so new runtime options do not require a second copied option list.
Field weights and graph-ranking policy reuse their execution owners' normalization.
It also includes resolved model/dictionary policy and adaptive provider admission.
Operational query-cache retention/prewarm settings are excluded. Overridden raw
defaults and unrelated API credentials cannot change the effective fingerprint.
Only digests enter cache identity; whole raw configuration is not hashed or written
into a public receipt. Local query-cache signatures carry the same identity in
addition to their existing resolved backend, model, filter and generation evidence.

Before outer lookup, policy preparation uses bounded repository concurrency and
loads configuration/auto-policy once per member, then normalizes its mode plans.
It reuses the auto-policy owner's existing bounded repo-stat memo. Preparation
joins its started workers before propagating failure or cancellation. A failed
member policy cannot authorize an outer hit or persistence; ordinary strict/partial
fanout handling retains the actual error. An unchanged, qualified production path
continues to use the outer cache.

Each production child receives an opaque process-local policy capture bound to
the canonical root, exact argv, exact mode and score override. A plain JSON
lookalike cannot supply that authority. Child config, normalized retrieval options,
model/dictionary policy and embedding intent consume the captured values. A config
edit after admission therefore cannot execute under one policy and publish under
another. The next request resolves the new policy and selects its own cache key.
Captured values have independent mutation ownership; full capability reporting's
lazy native-probe getter is not enumerated or triggered by capture.

Hosts providing a custom `searchFn` must supply a stable internal `searchPolicyId`
for persistent outer reuse, and must change it when their execution semantics
change. Without a qualified ID the callback still executes with all existing
request/generation checks, while outer persistence/reuse is disabled. This is a
host integration contract, not a new CLI, HTTP, MCP or workspace config option.
Qualified test callbacks declare that identity explicitly so existing cache-hit,
malformed-cache, strictness, generation, redaction and cancellation assertions
continue to exercise real reuse.

The authored tiny two-repository fixture uses actual core retrieval and explicit
before/after hit order for relation boosting, unchanged generation, cold/warm
hits, an independent sibling, raw override/cache-only changes, environment policy,
secret exclusion and mid-request config edits. It also covers invocation binding,
mutation isolation, lazy capability admission and unqualified custom callbacks.
Functional execution and performance qualification remain deferred; these source
changes do not establish a current-head suite or measured latency pass.
