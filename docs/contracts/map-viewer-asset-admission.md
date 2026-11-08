# Pinned local asset admission

Preview pinning reads each asset through one bounded original file descriptor.
It captures the descriptor's close, stat and stream methods, copies admitted
chunks and compares the before/after descriptor and source-path observations.
Each file remains limited to 8 MiB; the existing 256-asset and 32 MiB session
budgets still apply. These observations detect specified changes, not an atomic
filesystem snapshot or a browser module compatibility proof.

Read failure and descriptor cleanup failure remain exact separate causes,
including falsey throws. Failed descriptors remain retained by the existing map
resource owner. Explicit release waits for any original read-work observations,
calls only the captured close method and preserves fulfilled close evidence.
Reopening a path or copying resource fields cannot acquire that authority.

An optional missing asset may retain the existing unavailable diagnostic.
Cancellation, original ownership/inspection evidence and descriptor cleanup
failure terminate preparation instead of becoming a missing optional texture.
Required failures preserve their original causes without consulting diagnostic
getters again. Actual pinning and descriptor controls are authored but unrun;
native filesystem, post-install and browser qualification remain separate.
