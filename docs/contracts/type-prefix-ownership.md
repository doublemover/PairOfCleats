# Qualified type-prefix ownership

The shared type normalizer recognizes a Rust module prefix only at the root of
one complete qualified path. A user path such as `domain::std::Thing` retains
its inner `std` member. Recognized root normalization continues inside generic
arguments; Unicode identifiers, raw identifiers and quoted literals cannot
impersonate a root token. One root is removed per qualified path, preserving the
remaining path and its existing absolute-path marker.
If removal would expose another removable root token, the original path is
retained so repeated cache/consumer normalization cannot remove another owner.

C# `global::` cleanup likewise requires a distinct root token, including when
whitespace surrounds `::`. A Unicode alias ending in `global`, an escaped alias
or a qualified member cannot become that token through ASCII word boundaries.
The existing documented root-prefix conventions remain normalization policy,
not source-context alias resolution or a proof that two runtime types coincide.

Shared `typeNormalization` identity changes. Authored canonical and actual
parser/document enrichment regressions remain unrun; compiler, real-server and
full indexing qualification are pending.
