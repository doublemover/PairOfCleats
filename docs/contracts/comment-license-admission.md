# Comment license admission

Default classification version2 recognizes structured notice lines inside the
existing header window: SPDX-License-Identifier fields, copyright/symbol notices,
standalone MIT/Apache license titles, known License: identifiers, explicit
"Licensed under" notices and the standard permission grant. It does not classify
ordinary words such as submit, commit, permit or limits, or incidental references
to Apache/copyright/license configuration, as legal boilerplate. Ambiguous prose
retains its ordinary documentation role. This recognizes notice intent; it does
not validate license identifiers or provide a legal determination.

Custom licensePattern expressions keep their raw-comment matching semantics and
existing safe-regex limits. The default expression remains below the unchanged
512-character pattern cap. Re-normalization and file-analysis worker projection
preserve actual compiled safe-regex source, flags, engine and limits; a lookalike
object cannot become an owned matcher. Matcher cursors are not policy identity.

The compatibility type remains license for a qualified occurrence, while internal
comment metadata retains originalType and licenseClassification with policy
version, reason, confidence and comment-occurrence scope. Tokenization records
proseAdmission and an explicit license-excluded reason. includeLicense retains its
existing control. A mixed documentation/notice comment is excluded as one whole
occurrence when that control is false; its original doc role/ranges/raw text stay
available. This change does not invent a notice-region parser or alter artifact
schemas. Existing min-character/token, noise, header and per-chunk bounds remain.

Paired prose extraction caches raw comments/config segments only, under file
hash/algorithm, extension, language and a versioned effective policy identity.
The cache owns immutable branded data visible to its byte accountant; consumers
receive independent clones. Unbranded author/stale entries are misses. Consuming
passes tokenize and admit segments using their current dictionary/config, so
dictionary-dependent tokens cannot leak from an earlier paired pass. Prose
priming extracts source once without prematurely tokenizing an unused product.
Incremental parse/token identities include the classification version, and shared
sourceChunking advances from33 to34 to invalidate changed derived meaning.

Unrun regression owners are comment-license-admission and
comment-policy-extras-cache, covering actual buildCommentMeta/tokenizeComments,
positive notices, ordinary and Unicode prose, header boundaries, mixed content,
custom/worker-restored matchers, exclusion receipts, stale/fresh/warm caches,
immutable cached data and current-dictionary/current-token admission. Existing
matcher, join/boundary and LRU coverage remains intact. Static checks do not
qualify runtime behavior or a full index.
