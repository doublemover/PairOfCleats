# Viewport input callback and subscription lifetime

The actual viewport input owner retains each original listener registration and
removal method with its exact surface, event name and private callback. The
remover is captured before registration, including when registration installs a
listener and then throws. Later method replacements or reported owner/callback
fields cannot provide removal or reconciliation authority.

Construction checks its original prerequisite before and immediately after every
listener-method getter and registration, and before and after the initial focus
read. Revocation stops subsequent getter inspection, listener acquisition and
focus publication. Already installed listeners retain their original removers.
The accepted construction stack gates both the aggregate owner and its individual
removers. Original registration, prerequisite and callback failures are retained
on every already captured remover as well as the aggregate owner, so explicit
remover reconciliation cannot bypass independently pending original work.

Disposal revokes callback admission before physical cleanup. Retained or queued
original callbacks cannot focus the viewport, claim keyboard defaults, add keys
or invoke motion/shortcut callbacks afterward. The actual controls consumer also
supplies its original controls callback and renderer identity as a revocation
prerequisite. A false observation is latched, clears owned keys and cannot be
revived by a later true observation. Shortcut and default-action returns check
that prerequisite before later key writes. These are synchronous DOM callback
contracts; asynchronous input callbacks are not newly supported.

Accepted original callback stacks remain prerequisites for physical disposal.
A reentrant disposal request can revoke publication immediately but cannot
remove subscriptions until that stack returns. Independent original motion and
invalidation callbacks and every listener removal are attempted during teardown
even when an earlier action throws. Reentrant cleanup reports its own original
pending stack without adopting a sibling owner or creating a self-closure cycle.

Each failed or unfinished exact removal and the aggregate input owner remain in
the existing scene-resource inventory. Ordinary repeated disposal reports the
retained failure. Explicit reconciliation must use those exact capabilities and
wait for their original prerequisites; it does not retry completed removals or
one-shot motion/invalidation callbacks. A fulfilled asynchronous removal is
joined rather than repeated. Unknown pending registration/removal work stays
unconfirmed, including when only lookalike public owner fields are present.

The actual owner and inert subscription/callback/partial-acquisition controls
are **UNVALIDATED**. No tests, syntax/lint/format, bootstrap, DOM/browser/native,
renderer/GPU, build or benchmark execution was performed. Real event-host
behavior, native retry safety and input latency/performance acceptance remain
separate. Outer controls independently attempt their captured child cleanup;
pending original work or an unconfirmed removal can still keep subscriptions
owned. Revoking input callbacks does not prove their physical removal.
