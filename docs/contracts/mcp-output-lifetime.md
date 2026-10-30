# Legacy MCP output lifetime

The legacy Content-Length transport owns output separately from tool execution.
Protocol helpers return their original write promises. Tool request identity and
lane capacity remain owned through both response settlement and actual handler,
child and native cleanup. A timeout response does not release still-running work.
Queued cancellation retains its identity until its cancellation reply settles.

Admission is serialized across parsed messages, while admitted tool execution
retains the existing fast/slow lanes. A control response waiting for stdout pauses
stdin and parser admission. Remaining coalesced input obeys the existing parser
byte limit. The next control message cannot add an unbounded chain of replies.

One connection owner sends one physical frame at a time. It reserves four reliable
terminal slots: two tool lanes, one control producer and one serial shutdown
cancellation producer. A slot is released on actual writer callback settlement,
before its public delivery promise resolves. Each terminal JSON body is bounded
at 32 MiB. An oversized result is replaced once with a bounded JSON-RPC internal
error, preserving the request ID and `error.data.reason: "output-limit"`. A failed
replacement or exhausted terminal reservation fails the connection; it cannot
recursively enqueue overload responses.

Only `notifications/progress` is lossy. At most two typed request keys retain their
latest pending progress, plus one already-writing frame. Progress bodies have a
64-KiB limit. Replacement, overflow and shutdown drops are counted. Reliable
terminals take priority over pending progress; an already-started frame finishes
before the next frame. Existing progress throttling remains.

Preparation captures UTF-8 bytes once, before queue retention. The shared writer
consumes the opaque capture once and preserves exact Content-Length framing. The
connection's retained/peak wire-byte counts include frame headers and active
physical writes. They describe queued encoded output, not total producer memory,
JavaScript heap, process RSS or throughput. Input, generated tool results and
native resources retain their own owners and qualifications.

A write has an internal five-second deadline, including before EOF. Shutdown
stops execution admission, aborts active requests, serially cancels queued work
and joins actual execution. It admits cancellation replies while draining output,
with a two-second flush deadline while output is pending. These are internal
lifecycle bounds; no public configuration or CLI surface was added. A `shutdown`
request sends its reply after execution drain. EOF/`exit` then seal output and
await its receipt before process termination. Output failure stops input admission
and produces exit status 1; confirmed drain permits status 0.

The bounded internal receipt separates admitted, delivered, known-unsent,
unconfirmed and rejected terminal counts. An error after a frame starts cannot
prove whether the client received it, so it remains unconfirmed. A flush timeout
can return `physicalWritePending: true` while the original callback and framing
lease remain owned. Late settlement updates live counters without rewriting the
earlier receipt. `writerRetired` is distinct from `streamClosed`; stdout is borrowed.
Neither failed delivery nor a flush deadline releases live tool/native work.

Authored fixtures use a controlled real Writable, the actual transport/protocol,
an independent test decoder and exact wire vectors. They cover a finite mixed
control/tool flood, progress replacement, reservation/byte limits, original write
errors, actual stream EOF, failed flush and delayed tool settlement. Virtual time
checks bounded ownership without a timing-only oracle. These fixtures are unrun;
they do not qualify measured latency, large workloads or the SDK transport.
