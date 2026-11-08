# Viewer preference session lifetime

Preference transport captures the selected repository, endpoint and session
token before its first await. Both GET and PUT responses use the shared bounded
64 KiB map body reader. Failed availability retains its exact original value,
including falsey throws, separately from the user-facing diagnostic.

The settings session serializes captured updates. A successful response must
confirm the next revision and the original requested preference values. Reset
continues to follow an accepted earlier write's actual confirmed revision.
Invalid layout keys cannot change prototypes or silently target another layer.
Status callback failures preserve the original failure and any independent
diagnostic. A callback failure after confirmation records the confirmed revision
without pretending that the durable write was rolled back.

Retirement clears debounce intent, rejects new and queued unstarted writes and
returns one original disposal promise. An already accepted write remains owned
until its original promise settles. It may still commit, but cannot update a
retired document or publish a late UI status. Existing original ownership
observers remain prerequisites for explicit reconciliation; disposal never
retries a durable write.

The shell captures its original settings disposer and owns late acquisitions
after pagehide. The actual viewer initializer stops when that admission returns
false. This prevents late settings acquisition from starting renderer work in a
retired shell. Complete shell partial-construction teardown, real browser page
lifecycle and durable multi-tab/keyboard/screenshot qualification remain open.
Consumer regressions are authored but unrun in this wave.
