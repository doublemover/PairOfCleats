# Source-backed compiler dispatch candidates

Implementation status: UNVALIDATED. The authored regression has not been run.

The existing TypeScript compiler session augments checker signatures with bounded source-backed callable, object, class and prototype candidates. These property candidates remain modeled and incomplete: receiver mutation, accessors, escaping values and constructor behavior do not become observed runtime dispatch.

Class lookup tracks shadowing separately for every requested property key. A derived implementation of `local` does not hide the base implementation of `inherited` when a computed call admits both names. An exact runtime member shadows its own key. A computed member with several possible names, a widened key or a declaration without known runtime presence preserves the corresponding base candidates and an explicit conservative reason. Static lookup uses the same rule. `super` follows source-backed `extends` classes only.

The existing immutable member index still owns reusable structural lookups; each call keeps its own traversal, candidate and target bounds. The compiler binding producer version controls replay admission for changed candidates, and existing input partition hashes carry those changes into local and cross-file flow partitions. Candidate discovery does not establish language closure or authorize edits.

`indexing/semantic/compiler-dispatch-alternatives` authors direct candidate regressions for union keys, exact overrides, static lookup, declaration-only fields and uncertain computed member names, alongside canonical call-flow return-channel inspection. Native compiler differential qualification and performance acceptance remain pending.
