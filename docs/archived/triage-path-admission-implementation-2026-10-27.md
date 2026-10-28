# Triage record target admission — 2026-10-27

**Unvalidated source:** `f564f5f79871ad466be0246a4920e2c605135ee9`, tree
`4ef68afef335d6b63604e4534e2ebc1866b8a9e4`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Local source checkpoint; not published or functionally qualified.

The shared triage path resolver rejected traversal but could admit a Windows
alternate-stream component or reserved DOS device. Ordinary lexical containment
does not establish that the target is a normal file. Explicit imports feed this
owner before record publication; finding/context selection uses the same owner.

Admission now checks the complete Windows leaf, including its selected extension,
before any file operation. It rejects colon/stream syntax, reserved device names
and extension variants, superscript device digits, forbidden/control characters,
trailing dots/spaces and overlong components. IDs remain canonical strings:
implicit object/number coercion, NUL, path separators and trim aliases cannot
produce a differently named durable record. Extensions cannot reintroduce path
syntax. Ordinary Unicode, dot-prefixed names and reserved-name lookalikes such
as COM10 remain supported. Invalid writer messages are bounded and cannot invoke
a caller-supplied ID object's coercion method.

The Windows rules follow Microsoft's
[file/namespace naming contract](https://learn.microsoft.com/en-us/windows/desktop/fileio/naming-a-file)
and [stream naming contract](https://learn.microsoft.com/en-ca/windows/win32/fileio/file-streams).
Platform-specific filename restrictions apply to Windows; no non-Windows run or
qualification is claimed.

The existing context-path fixture gains positive/negative admission controls.
Two additional **unexecuted**
`tooling/triage/record-id-native-io-admission/{writer,reader}` cases install
filesystem barriers and require the original path error with zero attempted IO.
They never create/open a device, stream, directory, record or physical link.
Format/ESLint, JavaScript syntax, configuration budget and whitespace checks pass;
generated configuration inventory was refreshed. No functional fixture, native
experiment or publication front gate ran.

This is a prerequisite path-owner repair discovered while reviewing #821. It does
**not** implement or qualify coherent cross-process JSON/Markdown publication.
That issue still needs one owned record generation, atomic conflict decisions,
failure preservation and consistent indexing/source readers. Existing traversal,
fallback identity, normal explicit-ID reimport and finding snapshot checks remain
intact and await affected current-candidate validation.
