# Managed prebuilt Node packages

Windows Pyright cache installation uses the existing immutable managed archive
owner. The canonical recipe pins Pyright1.1.414 from the official npm registry,
its exact4,226,827-byte tarball and SHA512 integrity. Registry metadata and the
actual archive were reviewed on2026-11-07. The archive contains5,423 files and
19,457,120 uncompressed file bytes, including the bundled JavaScript dependencies
and typeshed. Its package manifest has no required runtime packages. The selected
optional `fsevents`2.3.3 resolution supports macOS only and is omitted on Windows.

Sources: [Pyright release](https://github.com/microsoft/pyright/releases/tag/1.1.414),
[immutable package metadata](https://registry.npmjs.org/pyright/1.1.414) and
[optional platform metadata](https://registry.npmjs.org/fsevents/2.3.3).
The recipe retains the complete package and validates its entry, bundled modules,
license and standard-library stub layout. Package build/clean scripts are not
installation steps; npm and package lifecycle hooks do not execute. Other npm,
Go, Ruby and .NET package/build closures remain separate #1559 work.

Storage admission reserves the shared extractor's enforced1GiB expanded ceiling,
the exact archive and32MiB for bounded staging/inventory/receipt metadata. This
is the existing archive owner's inclusive bound, not an arbitrary source-build
forecast or a claim about actual allocated Windows bytes. Required write roots,
original download/extraction/verification settlement, immutable generation
promotion, previous-generation preservation, reuse and explicit repair remain
with the existing managed installation/storage owners. No new publisher, receipt
format, shell wrapper, copied Node runtime or package-manager cache is added.

The descriptor's command identifies the owned `langserver.index.js` file. The
closed runtime adapter recognizes only the canonical selected Pyright recipe,
version, entry and physical generation. It launches that entry with the running
application's supported Node26 executable and exact argv. Explicit external
commands keep their existing selection. Damaged/unreadable selectors, stale
managed entries and another Node host cannot silently become an unmanaged
fallback. The selected original package is included in the existing managed
command closure and stays leased through actual probe/client child retirement.

Read-only selection, synchronous/owned probes, initialize handshakes, pooled LSP
sessions and workspace-health identity share the launch's actual command/argv.
The script prefix appears once and actual attempted child arguments are retained.
The Node prerequisite uses the application's exact executable, with no PATH or
system installation. Producer `lspBindings`67 prevents prior derived replay from
assuming the old launch meaning. Native/.NET recipes retain their active contracts.

Version verification runs the pinned CLI entry through the original async child
owner. It checks each original result field/settlement before projection and
preserves cancellation and pending work. Its level is explicitly
`pinned-node-entry-and-cli-version`; protocol and source analysis require their
own real consumer qualification.

Six cases are authored and locally unrun. An explicitly selected inert archive
uses real managed storage/publication, Node children, generation leases and LSP
framing. Controls cover reuse, stale/damaged selection, changed Node host,
unqualified external commands, checksum refusal with the previous generation
intact, exact argv, original field observations and pre-cancellation. These
portable resource controls are distinct from actual vendor Pyright execution.
Windows vendor install/initialize/source facts and high-water measurements remain
pending. Linux/macOS managed Pyright acquisition is not advertised by this recipe.
The author-workspace archive audit under `.tmp/tasks/managed-pyright-closure/`
is historical input inspection, not an asset promised in clean checkouts.
