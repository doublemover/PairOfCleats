# Lifecycle close flight

The existing registry closes admission once and exposes the same close promise
to concurrent, reentrant and later callers. Another close cannot return success
while accepted cleanup is still running. A rejected close remains rejected;
calling close again does not retry failed native destruction.

Default resource close/drain hooks capture their original methods and receiver
at registration. Later property or getter replacement cannot substitute another
cleanup owner. Explicit caller-provided hooks retain their existing contract.
Simple worker terminate, kill and close adapters likewise retain the original
method and receiver; the numeric-PID process-tree adapter retains its existing
policy. Best-effort error diagnostics consume asynchronous rejections without
turning a diagnostic callback into resource-closure evidence or changing the
unregister contract.
Independent hooks still run after another rejects, including falsey rejection
values. A falsey failure cannot turn drain or close into success.

`isClosed()` describes admission closure. It does not establish native child or
descendant settlement. The existing hook, unregister and worker-adapter policies
remain separate; this change does not qualify real subprocess teardown or make a
fulfilled arbitrary callback proof of native release.

The actual registry controls are inert, authored and **UNVALIDATED**. Tests,
formatting, bootstrap, native resource and Windows runtime acceptance are deferred.
