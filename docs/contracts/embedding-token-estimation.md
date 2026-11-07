# Optional embedding token estimates

The build runner's optional estimator uses `token-estimation.js`. Counts remain
planning hints, not a target-tokenizer guarantee for complete rendered context.
Ordinary estimator failures still permit heuristic fallback. Native ownership,
cancellation, aggregate failures and failed inspection do not become a missing
estimate: the original result/error observations must remain settled at each
field boundary, and unresolved work propagates through its original owner.

The wrapper captures the estimator and its receiver once. It owns the returned
array before normalization, checks every original element, accepts positive safe
integer counts and uses the existing per-text fallback for invalid scalar values.
It does not invoke arbitrary object coercion to manufacture a count. A pending
interval cannot disappear because a later getter changes an observation.

The exact release function retains its original returned-array receiver. Valid
counts transfer that capability to the existing pipeline owner. Malformed ordinary
results release their known preparation before fallback. Release failures retain
the original result and actual cleanup error; cancellation/primary failures survive
independent cleanup failure. Unknown work grants no new automatic cleanup or retry.

Five authored, locally unrun cases cover receiver identity, safe counts, negative
and malformed hints, ordinary/falsy fallback, native pending errors/results,
per-field observations, inspection failures and cleanup failure preservation.
This repairs the outer lifecycle boundary under #1765. The broader #779 requirement
to reserve bounded preparation windows before tokenizer work remains separate;
post-allocation retention limits do not establish that admission.
