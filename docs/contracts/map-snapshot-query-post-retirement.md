# Snapshot query post retirement

The actual worker client distinguishes an original query-post invocation from
abort subscription acquisition. If that captured `postMessage` invocation
throws, the dispatch settles independently and the client retires immediately.
Other accepted/queued dispatches settle, no later request posts through that
client, and late native messages cannot publish results or reactivate it.

The original native resource owner retains each post/termination/notification
outcome. Independent original scene/cache/diagnostic prerequisites gate native
termination and explicit reconciliation. A successful termination is retained;
explicit resource reconciliation never replays query transport or reactivates
the retired queue. This is the same retirement rule used for a failed cancel
post, extended to the actual query-post consumer.

Ordinary, dual-channel pending, falsey and independent native-close controls are
authored in the actual client fixture and remain unrun. Browser Worker behavior,
physical native work completion, performance and complete abort-listener
acquisition/removal qualification remain separate. No fallback or automatic
native failure retry is introduced.
