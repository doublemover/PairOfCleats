# Retained-answer integrity attacks

The #1526 `retained-answer-integrity-v1` offline adapter exercises the existing
[answer renderer/inspector](answer-evidence.md) under a fixed deterministic attack
matrix. It accepts a self-contained historical revision and verifies the original
before applying any intervention. It reads no current source, calls no model
provider and cannot grant source authority or executed-task success.

The matrix includes an identity control, moved citation coordinates, predicate
negation, changed numeric count, removed required qualification, wrong answer
world, changed quoted bytes and a replacement-input control. Text edits adjust
visible fragment/quotation spans. Every candidate recomputes the public digest and
exact serialized-byte counter, so rejection cannot be credited merely to a stale
envelope hash. Original provider/quotation support remains fixed in the negative
cases. Inspection recomputes the supported renderer, claims, maps and required
qualifications from those original inputs.

The replacement-input control recompiles different internally consistent supplied
quotation bytes. Historical integrity can accept that new revision. Acceptance is
explicitly insufficient for current source admission: only the existing live
query/retained-byte owner can establish it. This positive control guards against
mistaking a valid digest or coherent report for independently verified source
truth. Free-text entailment, downstream executor reliance and task outcomes remain
unmeasured.

Each case retains expected/actual outcome, mutation identity, verification work
and rejection class. A budget rejection or unexpected verifier exception does not
count as a successful semantic check. Unsupported fixtures remain explicit,
unsatisfied cases rather than disappearing from the denominator. A work deadline
retains checked results and unattempted case IDs, with no aggregate success claim.
Cancellation throws, and no accepted failure receives an automatic retry.

The closed matrix has eight cases, a 250 ms maximum cooperative case boundary and
a 128 KiB maximum output. Captured input and candidates use bounded canonical
encoding; original inputs remain unchanged. Adapter selection is explicit and
lazy, with only the selected profile's evaluator imported.

Four unexecuted regression cases cover the full re-sealed matrix, partial relation
counts, unsupported input shapes, the historical/current-authority positive
control, immutable inputs, strict case selection, output bounds and cancellation.
This is deterministic retained-report integrity coverage. Independent semantic
source-support judgments and broader qualifier/contradiction attacks outside the
closed renderer remain separate qualification work.
