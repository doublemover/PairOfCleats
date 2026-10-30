# Current-page selection lookup

The workspace constructs one identity lookup when its admitted projection page
is rebuilt. Selection, relationship endpoint labels, tree ancestry and retained
selection checks share it. Page, relation-scope or response replacement drops the
previous lookup; no global page/generation cache or adjacency index is added.

The lookup preserves the first strict identity match, including duplicate-ID
boundary inputs and distinct numeric/string IDs. Edge order, parallel rows,
self-edge direction, missing-endpoint labels and original source records remain
unchanged. The existing 200-node/400-edge admission bounds remain in effect.

Authored controls compare lookup and scan results, count one ID read per indexed
node across repeated endpoint selections, and exercise actual DOM-emulated
paging, replacement, filters and history. That source work count is not measured
browser latency or FPS. Map build cost, retained memory and actual interaction
performance remain separate qualification work.
