# Cross-file return confidence

Cross-file forwarding retains typed supporting facts rather than discarding
their scores into a type-name set. The existing string `returnTypes` summary is
kept for presentation compatibility; `returnTypeFacts` carries the type, source,
finite score or null, and seed owner/source/score through the actual transform.
Both summary-based forwarding and the existing non-JS name fallback consume the
same fact representation. The pass snapshots facts after tooling and constructor
seeds and before bundle traversal, preserving its current one-pass behavior.

`TypeEntry.confidence` on a forwarded return is an evidence strength, not a
calibrated probability. The policy is the minimum of the immediate supporting
fact's finite score and the existing local same-file/cross-file hop strength.
This cannot amplify weak support. Explicit zero remains zero. Missing confidence,
including an unscored declared type, stays null; the transform does not invent an
annotation score. Local hop strength remains separately visible in
`evidence.returnPropagation.localConfidence`.

The version1 evidence record declares basis `minimum-support-and-local-hop`,
immediate `sourceConfidence`, seed `origin` and immediate supporting declaration
`via`. Origin retains chunk UID when available, source file/name/range, original
source tag and score. Forwarding already propagated evidence keeps that origin;
it does not grow a complete path or relabel the previous local hop as a new seed.
Independent origin/source/score/via identities remain distinct return entries.
Repeated evidence for the same support retains the strongest alternative score;
scores are never added as if independent probabilities. Ordinary nonpropagated
return merging retains its established type/source key.

The existing MetaV2 writer preserves this evidence object, and the existing
cross-file cache serializes and restores it. The cache fingerprint binds the
return-evidence producer version, while the shared call-flow producer identity
must also advance for the changed derived output. No new store, option, provider
acquisition or metadata schema relaxation is introduced.

Authored controls exercise real parser/call/chunk consumers, qualified source
reads, cold/serialized replay and MetaV2 output, plus legacy name fallback,
same/cross-file forwarding, weak/strong/zero/missing/declared support, independent
sources, repeated invocation, reversed chunk order and unseeded recursion.
Validation is deferred for this implementation wave. This is not transitive
fixed-point inference, deletion-safe reuse, calibrated confidence or a preserved
opaque upstream proof. Those remain separate from the compact origin receipt.
