# Generated artifact prefix descriptor lifetime

Status: UNVALIDATED source and authored controls, 2026-10-23.

The shared `inspectGeneratedArtifact` consumer keeps candidate-path admission and
the existing recognizers. Ordinary paths perform no prefix read. The default
candidate reader borrows its actual FileHandle through `withContainedFile` and
reads at most 8192 bytes using captured original stat/read/close methods. Positive
short reads finish the admitted prefix; nonpositive, fractional or excessive
progress cannot classify a partial successful result. Exact original descriptor
stamps and final contained path/object verification precede closure and parsing.

Settled classification/read failures still preserve the input as ordinary source.
An original resource observer, including one without a pending flag, must confirm
settlement before that optional outcome is returned. Failed native closure keeps
the actual contained descriptor capability and exact primary/secondary causes.
The same original-observation checks apply to an injected reader's result and
failure, before and after classification and diagnostic field access. Replacing
public handle methods or an error's observer cannot acknowledge its predecessor.

Discovery and watch already await this shared inspector before generated-file
exclusion or ordinary file processing. This source change does not edit their
scheduling, cancellation, semantic policy version or generation ownership. It
does not change the recognized marker formats or allow marker content to exclude
other files.

`tests/shared/generated-artifact-resource-lifetime.test.js` authors the public
consumer with real disposable FileHandles: bounded positioned short reads;
original-method replacement; malformed progress and changed stamps; ordinary
falsey/frozen failures; independent read/close causes; pending work prohibiting
destruction; exact explicit close without read/classification replay; and original
custom reader result/error/diagnostic observations. Existing generated artifact
recognition assertions remain in their original fixture.

No controls were run. This is not cross-process discovery/native acceptance.
Descriptor stamps and containment checks do not make a later path mutation atomic.
An explicit close capability only settles that actual descriptor and its captured
prerequisites; it does not replay classification or authorize category cleanup.
