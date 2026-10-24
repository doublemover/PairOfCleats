# Cross-file module export targets

Status: UNVALIDATED source and authored controls, 2026-10-22.

Cross-file JS/TS entries now carry the existing canonical docmeta `exported` and
`exportNames` observations into import target selection. The producer remains
`resolveJsTsExports` under its existing module-export version. Imported aliases,
including string-literal names and named TypeScript default exports, select the
actual local declaration recorded by that owner. Its local producer version3
also retains optional `typeOnlyExportNames` for erased export aliases and
declarations; generic exported API identity remains available while runtime
calls exclude those names. A returned construction cannot create a nominal
type through an unavailable explicit runtime export. An explicitly private,
unknown or inconsistent export observation cannot recover through a declaration
kind, local spelling or global-name fallback. Unimported references keep their
existing route.

A named or namespace imported member first selects an exported root. Its exact
qualified suffix must identify a candidate in the same file whose nonempty
source interval lies inside that root's interval. The existing symbol-name index
supplies member candidates; no file-wide root/member Cartesian product is added.
A disowned root symbol cannot lend export authority to another member. This is
an existing static target candidate route, without proof of runtime dispatch or
static-versus-instance legality. Default-member targets remain unsupported.

The existing full docmeta fingerprint binds export observations to derived
replay. Shared call-flow/import-resolution identities must advance for the
consumer meaning change; root owns those shared versions. The existing
module-export version binds the additional producer distinction. No schema,
default, limit or source acquisition path changes.

The authored canonical export owner -> actual file/chunk handoff -> pinned
cross-file cold/warm fixture covers JS/TS export aliases, renamed-away local
spellings, string names containing dots, named defaults, namespace aliases,
exported class members, private declarations, unknown export metadata, disowned
roots, missing member source ownership and type-only export/import value misuse.
The producer controls retain declaration/specifier erasure and type-only default
interfaces. The fixture also retains a legacy direct-name
compatibility control. None has run.

Rows without these explicit export observations retain the earlier unqualified
name/kind route. The module-export owner has its own incomplete/unsupported
cases, including some reexports and namespace contents. Computed path spelling,
dynamic property identity, runtime member legality, package/configured module
resolution, arbitrary supplied metadata authority, source/native/embedded
qualification and performance remain open. These observations do not establish
complete ESM/CommonJS binding or general source-language semantics.
