# MCP test wire reader

`tests/helpers/mcp-client.js` selects the expected response transport before
spawning a server. Its reader uses explicit legacy Content-Length framing or SDK
newline framing. It does not autodetect another transport or discard stdout
noise. UTF-8, JSON, response/notification envelopes and duplicate headers are
checked independently of the production parser. Legacy headers require CRLF;
SDK messages require a complete newline. Partial scalars and headers retain their
byte identity across arbitrary pipe fragmentation.

One continuous listener owner retains data between calls. One public read may
be active at a time. `readMessage` records notifications and advances to the next
response; `readAnyMessage` records and returns them. Existing notification-array
clearing remains supported. Stream failure, cancellation and malformed output
are terminal and reject pending/future reads. EOF drains already completed queued
messages, but partial headers/bodies fail. Cancellation releases reader listeners
and buffers; the existing server helper still owns subprocess termination.

Default bounds are 8 KiB of headers, 8 MiB per message, 16 MiB retained wire bytes,
1,024 queued messages and 256 retained notifications. Fixtures may explicitly
lower these bounds. Overflow fails with a descriptive protocol error rather than
dropping a terminal message or pretending a sampled tail is complete. Fixed
64-KiB owned body slabs bound buffer-object count independently of fragment count.
Retained-wire metrics include partial frames, queued payloads, active delivery and
notification history. They describe logical wire extent, not measured process RSS.

`mcp-test-reader-fragmentation` authors independent UTF-8/wire vectors for every
split point, the first-CRLF discriminator, bytewise/coalesced traffic, large
fragmented bodies, wrong framing, contamination, unsafe/oversized lengths,
malformed payloads, EOF, queue/notification/byte limits, cancellation, original
stream errors and listener cleanup. Functional execution is deferred in the
implementation-first campaign. Real server lifecycle fixtures remain separate;
this helper does not qualify production outbound backpressure or shutdown flush.
