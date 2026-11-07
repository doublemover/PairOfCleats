# Type alias ownership

The shared type normalizer feeds canonical type-entry merging and provider
payload admission. Its identity preserves identifier case, qualified names and
quoted literal contents. A supported alias applies to its own name; a user
namespace ending in `Optional`, `Union`, `String`, `Number` or `Boolean` does not
inherit the standard alias meaning.

For Python, bare `Optional` and `Union`, and their `typing` and
`typing_extensions` qualified forms, use balanced constructor rewriting. Known
`typing` names lose that leading standard namespace. Standard builtin type
names such as `builtins.str` and `builtins.list` lose their builtin prefix;
unknown builtin-qualified names remain qualified. A containing user namespace,
such as `custom.typing.Optional`, remains intact. Nested supported constructors
inside a custom generic still normalize independently.

Python delimiter ownership is computed once per expression. Rewriting admits
at most 65,536 masked UTF-16 code units and 128 nested delimiter pairs; malformed
or larger structures preserve the complete original spelling. Each union
argument is rewritten once. These are internal normalization bounds, not a new
configuration surface or a source-language parser claim.

Quoted contents are protected before whitespace and alias normalization.
Unexpected NUL input preserves the original expression so source text cannot
impersonate a private literal placeholder. Provider payloads continue through
the existing type-entry merger and its candidate cap; qualified facts are not
silently deduplicated with standard aliases.

Shared `typeNormalization:3` retires the previous canonical meaning through the
existing semantic policy identity. This is distinct from compiler/LSP algorithm
versions and introduces no alternative cache or public normalization setting.

The authored helper, merger and provider-admission regressions are unvalidated.
Native provider, application and performance qualification remain separate.
