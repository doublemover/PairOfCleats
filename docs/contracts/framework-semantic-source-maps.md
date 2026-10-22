# Framework semantic source maps

Status: **UNVALIDATED implementation subset** for issue #1190. No compiler,
language server, fixture or gate was executed for this change.

Astro component frontmatter is admitted as TypeScript, including frontmatter
without annotations. Browser script blocks retain their existing explicit
language handling. The installed Astro compiler's parser supplies the original
frontmatter range; the existing segmentation and immutable embedded-source
owner preserve that exact slice. This enables the existing TypeScript syntax
collector to retain interfaces, annotations and indexed-access types instead of
routing them through the JavaScript parser. The canonical embedded-linear map,
source hashing and storage contracts remain authoritative.

This follows the [Astro TypeScript contract](https://docs.astro.build/en/guides/typescript/).
The authored `indexing/semantic/astro-frontmatter-dialect` fixture exercises the
actual app parser and TypeScript collector with Unicode, CRLF, a browser script,
typed declarations and canonical source/partition storage. Its parser fixture
and all assertions are unrun.

Framework-generated TSX maps, original template definitions, component
props/emits/slots and Svelte rune/snippet/Kit types remain pending. There is no
new framework service profile or approved managed executable pin. Vue/Svelte
compiler qualification, the Astro 2.x to 4.x migration, actual TypeScript service
version compatibility, trust for executable preprocessors/configuration and a
discovery-to-published-consumer proof are still required. Existing script
segmentation does not establish those semantics or complete framework coverage.
