# Deterministic answer revisions

The answer core compiles admitted indexed-query receipts and exact source
quotations into deterministic text, typed claims and UTF-16 fragment/source maps.
It also validates historical content and constructs exact-base answer patches.
Live query/source admission is available through `repository-answer`, MCP
`repository_answer` and HTTP `POST /analysis/repository-answer`. An opt-in
[retention owner](answer-retention.md) provides immutable support graphs and
exact-intent publication through the same transports. All authored runtime cases
are unexecuted; this contract is not a qualification receipt.

`compileAdmittedQueryAnswer` is an internal consumer of already-admitted results.
It is not an endpoint accepting arbitrary client JSON as checked evidence. A
saved answer or successful content inspection grants no current source-open
authority. Public integration must execute the existing pinned query and source
readers, settle their originals and project the final answer before publishing
any continuation.

The closed rule registry renders retained query tuples, qualified query counts
and exact source quotations. It preserves candidate certainty, typed scalar
representations and distinct declaration identities. Unknown scalar metadata is
explicit. It never converts a recorded candidate into a runtime callee or an
empty retained result into program-wide absence. Program semantics, alternative
support completeness and counter-support assessment remain separate fields.

Renderer2 encodes typed scalar objects with the existing canonical JSON owner.
Recapturing a saved revision or reordering equivalent input object keys therefore
preserves visible text, UTF-16 fragment spans, byte costs and revision identity.
Renderer1 revisions require regeneration; current inspection rejects them.
Query/answer CLI backpressure accepts an absent cancellation signal while still
forwarding a supplied original signal to the drain wait.

The existing task-evidence support join owns world/branch/assumption
compatibility. Deterministic rules build their observations from actual admitted
provider outputs; caller-supplied `checked` flags are not an admission path.
Support bundles retain their named rule/input IDs and acyclic claim dependencies.
Repeated quotation inputs produce one claim, without independent corroboration.
Caller requirements without an admitted checker remain visible and open; no
budget policy can delete a difficult requirement to improve apparent coverage.

Claim identities bind the predicate/version, exact argument digest and world.
Answer identities bind the complete input receipts, text, source maps,
qualifications, requirements and serialized cost. The semantic query receipt
omits only delivery cursors and invocation work metrics: the query owner creates
the cursor with `randomUUID` and measures elapsed time per invocation. Original
clause origins, selected witnesses, coverage, counts and unresolved facts remain
bound. The upstream opaque continuation must travel separately and unchanged;
it is never reconstructed from displayed rows.

Every visible span belongs to a deterministic factual template, mandatory
qualification or explicit open requirement. Quote mappings identify the exact
subspan containing source text, separately from the explanatory prefix. Quotes
check text length, content digest and whole Unicode scalar boundaries; live
integration must additionally verify their retained whole-source bytes through
the existing source reader. Header-only anchors never become byte-verified
quotations by being cited in a report.

Final JSON plus newline uses the existing 128 KiB context response ceiling.
Input/cardinality admission precedes report expansion. Incremental byte admission
charges text, claims and fragment maps before retention; final serialization and
its fixed-point byte count remain exact. An oversized required report fails with
narrower query-page/quotation guidance. Claims, qualifiers and original open
requirements are not silently truncated. Cancellation returns no completed
revision.

`inspectAnswerRevision` recompiles the supported rules from the immutable input
manifest and compares every field, including text, claims, maps, cost and digest.
This establishes deterministic historical content integrity, not origin,
permission, current applicability or the truth of arbitrary imported evidence.
Unexpected prose, changed source maps, cyclic/self-support edits and altered
qualification metadata fail inspection.

`reconcileAnswerRevisions` is the conservative full-recomputation baseline. Any
input-world change invalidates all old-world claims and dependent counts,
including negative-lookup and domain dependencies. It does not match facts by
name or text or claim incremental performance. Immutable prior answers remain
inspectable as historical records. Independent alternative support remains the
upstream provider's responsibility; the selected receipt cannot stand for every
derivation.

An answer patch names the exact base and next digest, added/removed/retained
claim IDs, world/text changes and a self-contained next revision. Patch envelopes
are bounded to twice the answer ceiling. `applyAnswerPatch` checks the original
base and independently recomputes the delta. A stale base or altered delta fails
explicitly; an asynchronous old result cannot overwrite a newer answer. Cross
repository/question comparisons require a separately admitted correspondence
adapter and are rejected by this baseline.

Five authored, unexecuted cases cover visible text and quote maps, Unicode
boundaries, typed values and unknown scalar metadata, qualified/empty counts,
open requirements, exact-base retractions, stale patches, cyclic support edits,
quotation-content disagreement, duplicate citations, bounded mandatory overflow,
cancellation and owner-proven invocation metadata separation. The live controls below are authored; all runtime/cost
qualification remain.

Public requests use `mode: "compile"`, a `questionRef` and the existing typed
execution `query`; optional `quoteRefs` name at most sixteen record refs and
`openRequirements` preserve unmet caller requirements. The server executes the
actual pinned query. It rejects raw checked receipts, narrative additions and
unsupported physical query shapes before generation/artifact admission. Only
private deeply frozen request snapshots can reuse grammar preflight; source,
world, config and permission admission are always fresh.

Requested quotations use the existing canonical retained-source owner for every
query backend. It verifies the same generation/inventory, record/source identity,
whole retained bytes and exact UTF-16 spans. The query backend itself remains
unchanged. Worktree text cannot replace the pinned source; corrupt retained bytes
fail instead of falling back. Header-only row anchors remain separate from these
quotations. The source phase admits at most 32 KiB of excerpts with the existing
1 MiB aggregate decoded-source bound and its own 250 ms interval. Query work keeps
its existing limits; response timings report the two phases and total separately.

The coordinator asks the query runner to defer cursor publication. Query readers
settle first, then quotation readers, then final rendering/comparison and complete
JSON byte admission. Only success publishes the original query capability. A
failed close (including a falsey failure), pending native work, source mismatch,
failed projection or cancellation cannot install the prepared cursor. The
upstream opaque cursor is returned unchanged as `continuation`; `--all` forwards
it verbatim while honoring stream backpressure.

`mode: "compare"` additionally accepts the exact `previous` answer. Its question
and repository scope and deterministic integrity are checked before fresh query
hydration. The server then produces a self-contained, fully recomputed current
answer patch and the original continuation. Final complete envelopes still fit
the 128 KiB ceiling; oversized required comparisons fail with narrowing guidance.

`mode: "inspect"` accepts only a historical `revision` and executes no query or
source read. It returns the inspected digest, content-integrity and count metadata,
with `currentSourceAdmission: "not-established-by-content-inspection"`. It never
returns a current applicability or read-authorization receipt. All three modes
have the same closed CLI/MCP/HTTP contract.

`mode: "deliver"` uses the same live query/quotation admission and takes a
`delivery` request envelope plus optional `quoteRoles` aligned with `quoteRefs`.
It returns a self-contained [evidence delivery plan](context-evidence-delivery.md),
with all selected bodies and the unchanged query continuation. Client-reported
context identity and base digests cannot attest visibility or suppress source.
World/question mismatch, unknown visibility flags and implicit retention are
rejected before reads. Required pack overflow or source-close failure installs no
prepared query cursor. Three additional unexecuted cases cover these contracts,
full source maps and actual CLI/MCP/HTTP paging/backpressure parity.

Optional `retention: {expectedBaseDigest: null | digest}` on compile/compare
records the intended question/world revision before query work. Interrupted work
can explicitly supply the exact `resumeIntent` returned by retained inspection.
The coordinator validates a complete answer, immutable storage receipt and final
envelope before object publication. Only successful storage commit publishes the
original query continuation. Storage time is reported separately as
`work.retentionElapsedMs` and included in total elapsed time. Retained compilation
reserves 8 KiB within the existing response ceiling for the delivery/head envelope.

`mode: "retained"` takes `repoRoot` and `questionRef`. It returns the latest
historical answer and pending intent for that question ID, or an empty result
without creating an answer namespace. Optional `revisionReceipt` selects an exact
immutable older revision and must match the requested question revision. The
receipt locates historical content; it does not prove current applicability or
that an orphan object was previously the published head. Reads validate content
and acquire ordinary cache admission, without source expansion. `--all` carries
each successful retained base digest into the next explicitly paged request.
It preserves the opaque query continuation and normal output backpressure.

Four additional unexecuted integration cases cover opt-in/history behavior,
obsolete asynchronous results and unpublished cursor controls, explicit resume
with cancellation, and real CLI/MCP/HTTP retained paging. No narrative adapter or
held-out model qualification is enabled.

Four additional integration cases are authored and unexecuted: real query/quote
admission with edited worktree and corrupt retained-byte controls; original
cleanup/publication, cancellation and late-settlement controls; forged receipt,
grammar, historical integrity and exact-base negatives; and CLI/MCP/HTTP parity,
inspection scope and backpressure. Small query fixtures explicitly omit synthetic
manifest padding; existing oversized-manifest controls retain their original
65,536-byte padding and every assertion. MCP error projection now checks original
resource observations before reading public fields, matching the semantic error
owner's fence and preserving falsey inspection failures.
