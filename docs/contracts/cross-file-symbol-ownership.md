# Cross-file symbol host agreement

A cross-file resolver entry represents one definition chunk. When the entry and
its supplied symbol both contain a `chunkUid`, they must agree exactly. An
explicit empty or non-string UID is invalid. A disagreement cannot redirect the
definition to another chunk's declared returns, parameter metadata or links.
The raw input is retained; the resolver omits that candidate rather than
rewriting its identity.

The same admission applies when building name/file indexes, when consuming a
caller-supplied index, and when formatting a candidate. It precedes scoring and
candidate caps, including import-narrowed candidates. Existing legacy entries
that omit one of the two UID fields keep the existing other-field fallback.
This does not qualify an entry that lacks all target identity or establish a new
external-symbol resolution scheme.

The cross-file fingerprint already binds the entire canonical symbol input and
host chunk identity. The shared call-flow producer version owns this changed
resolution policy so earlier derived replay cannot silently preserve a redirected
candidate. No resolution limit, default, source-reader contract or cache store
changes.

Authored controls cover mismatched/malformed identities, one-sided legacy inputs,
direct and import-narrowed caller-supplied indexes, actual pinned propagation to
declared return types, and qualified cold/warm replay. They remain
**unvalidated**. This source repair does not claim complete producer metadata
validation, compiler binding authority, duplicate chunk admission or runtime
qualification.
