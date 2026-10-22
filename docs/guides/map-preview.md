# Preview and saved map evidence

Use the canonical existing-index preview:

```text
pairofcleats report map --serve --repo <repository> --no-open
```

The command reads the selected existing index and never builds one. It admits
the preview only after the report's atomic publication receipt matches the exact
HTML bytes. Required report/model/node-list write failures are nonzero, with a
separate result for each requested deliverable. Optional cache persistence can
still produce a warning after a successful requested export.

The default listener is HTTP on `127.0.0.1`, using a random port. `--port` selects
a specific loopback port. A JSON `map-preview-ready` line on stdout records the
URL, selected identity, document and client hashes, and listener lifecycle.
Operational text goes to stderr. This is listener readiness, not a rendered
browser/frame result. Browser-opener failure preserves the usable URL.

Open recorded evidence independently of any current index:

```text
pairofcleats report map --serve --input <saved-model.json> --no-open
pairofcleats report map --serve --input <generated-map.iso.html> --no-open
```

Supported inputs are map model JSON (current version and legacy 1.0.0), recognized
generated map-cache envelopes, and a generated HTML document containing exactly
one JSON `map-data` payload. HTML scripts/configuration are not executed or
imported; the model is rendered with the installed local viewer. Report summary
JSON, node lists and raw `repo_map` index artifacts are rejected with conversion
guidance. Admission limits include 32 MiB input, 64 JSON nesting levels and
explicit entity bounds. Opening does not overwrite the selected input.

Saved evidence is labeled a saved snapshot. Its recorded generation provenance
is retained; it is not revalidated as the current healthy index. Unknown legacy
fields remain unknown. Source actions are disabled when the recorded checkout
is unavailable. A lone exported HTML document still depends on compatible local
viewer assets and is not a standalone portable viewer bundle.

Each running listener retains its own immutable HTML and bounded local module
closure. Later exports, input-file replacements and source edits do not repoint
that listener. `--out` remains an explicit new export destination and cannot be
combined with `--input`. Refresh is currently an explicit restart/selection;
in-place refresh/current-pointer notification and persistent session recovery
remain unimplemented. In-memory sessions need no shared mutable HTML lease.

Optional TLS requires both `--tls-key` and `--tls-cert` pointing to certificates
the operator already trusts. The preview never generates certificates or changes
the system trust store. `--no-open` suppresses browser launch. SIGINT/SIGTERM
cancels owned generation work and closes owned listener connections.

All changes in this repair slice are source-only. Prepared-index CLI failures,
atomic rename/disk failures, concurrent sessions, native Windows/macOS/Linux
opening and shutdown, browser/module loading and rendered acceptance still need
the deferred qualification runs.

Live previews save bounded viewer preferences in durable application state for
the explicitly selected repository, independently of random listener port. The
local endpoint requires this session's token and repository ID. A saved model's
root never grants write authority. A saved input without --repo uses session-only
preferences; pass an explicitly selected --repo to associate preferences with that
repository. Revision conflicts and save failures are visible. Saving appearance
never rewrites repository configuration or source files.

The [viewer workflow guide](viewer-workflows.md) connects preview/export with the
API evidence workspace and explains their distinct source and qualification
boundaries. It is self-contained and requires no private planning Page.
