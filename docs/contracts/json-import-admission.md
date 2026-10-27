# JSON import admission

Current implementation and its 19 focused cases are unvalidated.

Strict `.json`, `.resolved` and anonymous input use one native `JSON.parse` under
the common collector budget owner. `.jsonc` retains its own syntax parser and
existing strict/deep compatibility route. No strict input gains comments or
trailing commas. Native parsing retains last-key-wins semantics. Parser/Node/V8,
dialect and JSON reference policy version 2 identify retained extraction.

Both routes resolve existing global/namespace/per-collector controls through the
same owner: 262,144 source characters, 4,000 lines, 4,096 matches, 2,048 tokens and
30 ms are the defaults. Existing zero-cap meanings remain: zero token/match/time
limits disable those particular caps; zero source characters admit no nonempty
source. Whole-grammar input that exceeds character admission is rejected before
parsing; a valid truncated prefix is never treated as the full document. Strict
JSON line admission requires the whole input to fit because its value parser
does not supply exact per-property line ranges. JSONC retains qualified per-entry
line projection from its syntax product.

`JSON.parse` is synchronous and non-preemptible. Time is checked before and after
it, and its completed elapsed cost is accounted. A later timer does not interrupt
the native parse or prove a hard parsing deadline. Cancellation produces a
cancelled extraction, not another dialect/fallback. Unexpected parser failures
propagate; syntax rejection remains distinct from incomplete budget admission.

Strict and deep-compat data use one iterative deterministic preorder traversal.
An active container retains one child cursor, never a whole-width entries/values
array. Completed frames are released. At most 20,000 values and 20,000 active
frames are admitted per invocation. General and reference-value traversal share
these limits. Reference properties restart the existing depth-three value scope;
the same value is not walked again for each enclosing reference key. Preorder
replaces the former nested breadth-first ordering under a versioned policy.
Match/token admission precedes import Set growth; disabled caps still have the
aggregate traversal bound. Native parser/object/engine allocations remain bounded
by source admission, not by a claim to interrupt internal engine enumeration.

The existing import-extraction owner retains source identity, exact observed/
retained counts where known, unknown dropped counts, policy/limits and reasons.
Budget stops and invalid reference values cannot become a complete-looking empty
array. The config adapter's existing relation projection preserves this receipt.
File parse signatures include the new reference policy; shared import-resolution
producer advances 20→21. Receipt/artifact layouts and public controls stay intact.

Nineteen authored `indexing/imports/json-collector-admission/*` cases cover route
parity, cap precedence/zero semantics, whole-source/line admission, strict syntax,
duplicate/deep/prototype-like keys, wide and nested aggregate work, frontier
bounds, fake-clock before/after parsing, cancellation, invalid references and the
actual config adapter/relation handoff. Existing JSONC boundary, import extraction
handoff, replay and import-budget checks remain required. None has run for this
source; measured resource/latency qualification remains separate.
