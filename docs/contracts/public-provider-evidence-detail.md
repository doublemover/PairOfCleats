# Retained provider evidence in public semantic detail

Status: **UNVALIDATED query integration** for #1145/#1197 and source-linked
language adapters. No fixture, API host, provider, syntax check or gate ran for
this source release. It changes query projection; stored producer meaning stays
unchanged.

The canonical semantic detail request accepts explicit
`include: ["providerEvidence"]`. Default detail keeps its previous behavior.
The existing public runner used by API/MCP consumers hydrates retained evidence
record refs from the exact requested generation. It starts no compiler, language
server, parser, network request or generation mutation. A direct evidence ref
does not require an unrelated relation-query index.

The optional `providerEvidence` result contains compact source-qualified
references and diagnostics, captured LSP observations, or explicit unavailable /
budget states. It exposes producer, method and evidence-kind identity, original
source identity and qualified spans. A source-linked navigation target is
returned only after the existing reader verifies its published generation,
parser/source inventory and retained bytes. Ambiguous or unavailable targets
stay unresolved; the candidate count is not authority to navigate a candidate.
Captured LSP coordinates remain `provider-observation` under `observedTarget`;
they do not become independently qualified navigation, complete bindings or
structured type facts. No entry claims complete producer coverage.

No full report, generated document, binary/base64 artifact, signature graph,
display-type inference or arbitrary provider object is added to the public
response. Diagnostic messages have an explicit truncation flag. Unknown evidence
kinds and backends without admitted retained artifact access are unavailable.
The canonical result schema separates reference, diagnostic, observation and
state variants with exact allowed fields. A captured observation cannot acquire
a navigation target through an extra field; qualified reference state and
candidate count must agree with its verified target. Captured target coordinates
retain paired source ID/hash authority and cannot attach a span to an external
unidentified source.
Malformed framing, generation/source mismatch, unsafe paths, checksum failure,
invalid JSON and missing retained artifact/source stay errors. Budget exhaustion
is an explicit budget state, not absence or corruption recovery.

Hydration shares the existing page's row, byte and work allowances. Retained
sidecar/source verification bytes and compact output consume the same byte
allowance. Metadata/source reads and projected observations consume the same row
allowance. A bounded deadline is scoped to remaining page work and user
cancellation remains distinct. One retained observation is projected per
evidence step/page; the normal continuation retains that exact offset. A page
that cannot intrinsically admit the artifact produces a terminal budget state,
rather than repeating a cursor indefinitely. Large artifacts may therefore need
a future indexed evidence decoder; no independent larger raw-read allowance is
introduced. Mixed symbolic queries keep the remaining output allowance after
evidence reads. Cursor scope includes the pinned store inventory.

`indexing/semantic/public-provider-evidence-detail` and the extended
`indexing/semantic/lsp-structured-evidence-detail` fixtures are authored and
unrun. They exercise actual writer/sink/store/public-runner contracts under
synthetic parser inventory: field omission, source-qualified targets, observation
qualification, exact pagination, default no-hydration, cancellation, corruption,
missing artifacts and insufficient page rows. Operational published API/MCP and
platform/lifecycle qualification, generated schema freshness and real language
producer admission remain pending.
