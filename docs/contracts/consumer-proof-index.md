# Consumer proof inventory

`node tools/testing/consumer-proof-index.js` emits a read-only JSON projection of
the shipped-surface registry, the runner's single governance discovery snapshot,
ordered lane manifests and consolidation ownership. It runs no tests, scanners,
release steps or product operations and writes no repository artifacts. Redirect
its output to a task-owned `.tmp/` receipt when comparing candidates.

The source manifest digest binds the projector/registry-adapter identity and exact
observed path/content-hash pairs, including
case sidecars, rules, orders, manifests and referenced consumer sources. Physical
file identities are reported separately and do not make a digest machine-specific.
Each case retains its intrinsic lane, ordered lane memberships and fresh-process
boundary. A shared physical fixture can expose several independent case IDs.
The projection admits at most 32,768 cases, 12,000 files, 2 MiB per file and 64 MiB
of total input bytes. Each invocation owns its bounded read cache; no evidence is
reused across source or registry changes.

Optional `consumerWitnesses` in the existing consolidation ownership registry
reference exact discovered cases, negative controls, consumer source paths,
required scope and expected oracle kind. The initial pilots cover physical
coverage identity, fractional percentile/histogram consumers and falsey semantic
drain failures. Missing references, duplicate declarations, invalid scope metadata,
changed case inventories and lane/manifest disagreement fail projection.

Declarations remain `declared-only`, execution is `unobserved`, semantic
completeness is `unqualified`, and receipt references remain null. Packaging
metadata does not qualify release execution; the existing role-specific release
report contract remains authoritative. Scanner entry graphs, uncovered comparisons,
unread sources and external platform results remain explicitly unavailable.

`compareConsumerProofIndexes` reports removed cases, changed test bodies, changed
consumer sources and weakened/removed witness declarations. A claimed replacement
or surviving case name cannot certify preserved negative assertions. These are
review candidates; the comparison never qualifies destructive consolidation.
Share fixture setup only after every independent assertion, consuming contract and
required process boundary has a reviewed surviving witness. No existing gate or
test has been replaced by this report.
