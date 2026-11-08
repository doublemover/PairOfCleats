# Preview subscription acquisition

The real preview runner acquires external abort, internal abort, SIGINT and
SIGTERM subscriptions inside its guarded startup. Each acquisition records the
original remover before invoking registration. An original registration that
installs and then throws still reaches that exact remover after the original
startup and registration stacks return. Captured methods retain their original
receiver; later method replacement cannot redirect cleanup.

Logical retirement and abort happen promptly. Native listener, subscription and
pin cleanup still require their original prerequisites. Every independent
scene/cache/diagnostic observation on a startup or cleanup failure remains
retained. Failed removers expose original pending resource capabilities, and
explicit reconciliation cannot repeat a fulfilled removal or adopt a sibling.
The original startup error and every attempted cleanup failure remain causal
values, including falsey thrown values.

The actual-runner and lifetime controls are authored but unrun. They do not prove
real process-signal delivery, HTTP listener behavior, browser/native shutdown or
performance. An inaccessible partial native allocation remains unqualified.
