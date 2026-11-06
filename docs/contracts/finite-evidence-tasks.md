# Finite source-evidence tasks

The initial #1525 compiler admits authored, in-memory source snapshots under the
closed `finite-source-evidence-v1` profile. It produces visible source manifests,
private interval-coverage oracles, declared lineage, split manifests and typed
task outcomes. This supports read-only evidence selection without executing
candidate programs, shell commands, tests or external model providers.
The base-only profile is implemented; history-permitted records remain
quarantined until their own qualified adapter is available.

Source text is captured before use, limited to 128 files, 128 KiB per file and
4 MiB of canonical compiler input. The existing canonical source-identity owner
binds actual UTF-8 bytes, repository namespace, path, language and decoding.
Original UTF-16 boundaries use the existing shared coordinate owner; malformed
Unicode and split surrogate pairs are rejected. Source paths remain canonical.
Known VCS/cache/private-oracle paths or source/task availability beyond the
declared cutoff quarantine the task. Quarantined tasks remain in split/outcome
denominators and cannot expose a candidate packet or become runnable.

The public task identity binds only visible task/specification content and its
source manifest. Private oracle edits invalidate the trusted compilation identity
without changing candidate packets or exposing a digest that could be searched
against a small hidden answer space. The original compiled handle has no oracle
fields. Explicit trusted inspection/scoring APIs own the private data; no
untrusted callback or plugin JavaScript is accepted. This is an in-process
declarative profile, not filesystem/container isolation for arbitrary programs.
Private oracle availability is retained separately, including future reference
labels that must never be copied into visible inputs.

Oracle alternatives form an OR; each alternative's groups form an AND; a group
requires q distinct declared source intervals. Source coverage is computed from
unions of exact candidate spans. Overlap does not multiply source bytes or covered
units. Different sufficient alternatives are accepted. These are benchmark
certificates in the supplied model, not claims that all other solutions are
impossible or that source origins are statistically independent.

Partial/unknown labels cannot turn a missing group or empty label set into a
negative. An explicit verified-empty oracle additionally requires complete
declared coverage and no positive units/alternatives. Unverified or incomplete
oracle premises stay unknown. Invalid source evidence or declared evidence-budget
violations fail separately. Not-run, timeout, cancellation and tool-error outcomes
remain visible with unknown task result. Execution status and task result are
separate axes, and no submitted span is inferred to have been read or used.

`assignEvidenceTaskSplits` freezes up to 64 original compiled tasks under weights
summing to 10,000. Connected declared repository/clone/fix/trajectory/origin/
synthesis ancestry and exact source hashes stay in one split. Original compiler
digests are reused without hashing source text again. Seeded component assignment
is independent of corpus order and oracle answers. Near-duplicate recall,
below-threshold review, historical exposure and training contamination remain
explicitly unchecked. Equal utility text can conservatively overcluster tasks;
this exact-edge audit is not a contamination-free corpus qualification.

Scoring requires the original split manifest and exact compiled member. Private
oracle or split revisions invalidate prior trusted outcome identities. Candidate
packets omit membership, leakage keys and private hashes. Compilation and split
semantic IDs replay deterministically; separate actual execution IDs retain the
cost of repeated preparation/scoring. Shared preparation is referenced once by
its original execution ID. Source bytes, compilation/split work and score work
remain distinct; unmeasured RSS/build/model work is not reported as a zero.
Explicit retirement drops the owner's source/oracle references and rejects later
reads/scoring through that handle. Retirement is idempotent; previously returned
immutable views remain caller-owned. This profile holds no native resources.

Five unexecuted cases exercise private-label noninterference, actual snapshot
immutability, all eight evidence subsets for alternative and q-of requirements,
overlap/contiguous coverage, unknown versus verified-empty labels, failed run
denominators, transitive declared/exact-source leakage groups, corpus-order
replay, future/metadata quarantine, strict source authority, Unicode, budgets,
original handles and cancellation. Actual isolated workspaces, independently
qualified repair/test-log oracles, semantic clone/chronology audit and broader
executed-task/provider campaigns remain separate #1525 work.
