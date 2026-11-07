# Origin and route observations

The `origin-observation-v1` offline adapter supplies #1526's cheap origin-collapse
baseline. It reuses the existing task-stage trace validator and evaluator for
source generation, exact original byte spans, event identity, terminal cutoff,
observable use attribution and unknown instrumentation. It reads no source text
and introduces no second telemetry collector.

An input binds the saved trace to explicit origin records, source-to-origin
lineage receipts and typed edge claims. Origin records keep dependence groups,
declared independence assumptions and unknown status separate. Repeated visits,
quoted documents and several graph routes to one origin increase route/incidence
counts without increasing distinct origins. Equal text from separately authored
origins retains separate identities. A content digest never establishes origin
independence or justifies collapsing those identities.

Stage reports separate accepted events, source identities, origin/event
incidences, distinct origin IDs, known dependence groups, declared independent
groups, unknown independence and missing lineage. Counts are descriptive metadata,
not independent probability mass. Unknown/uninstrumented use is not inferred from
delivery. Rejected stale spans and missing bindings leave coverage partial instead
of disappearing into a complete zero or a negative claim.

Edge types remain observed-transfer claims, reported parents, citations and
hypotheses. All event/run references and identities must match. Transfer/parent
claims must follow original event order; a reported cycle/backward derivation is
rejected. An admitted transfer claim needs compatible contained source spans.
Citations do not become transfers, and a hypothesis can retain a proposed cycle
without being rewritten into a causal DAG. Valid schema/event metadata does not
prove that an edge was independently observed or causal.

The pair comparator accepts original completed owner receipts and pins task,
source generation, repository/family, query and judgment policy. Shared origins
cannot silently change dependence/assumption identity. Input/run identities may
differ for the declared treatment. Full-coverage count differences are separate
from repeated-incidence differences; partial coverage yields an unknown delta.
Source support, executor reliance, task outcome and causal effect are not inferred.

Input is capped at 4 MiB, 1,024 origins/bindings and 4,096 edges. The existing
trace evaluation shares the caller's maximum 250 ms allowance; no timeout retry
or larger nested deadline is used. Output is capped at 128 KiB. Budget exhaustion
returns an explicit incomplete result without an owned comparison receipt;
cancellation throws. Original inputs are captured before asynchronous work.
The adapter registry lazily loads only the explicitly selected finite-model or
origin-observation owner, with closed capability lists and no fallback executor.

Four unexecuted cases cover repeated routes/quotation lineage, actual equal bytes
from separately authored generators, distinct dependent versus unknown origins,
partial instrumentation, missing lineage, stale spans, foreign/cyclic/fabricated
edges, immutable capture, original receipt ownership, scope changes, bounded
output and cancellation. Independent source-support/qualifier attacks, factorial
utility probes and held-out provider qualification remain separate work.
