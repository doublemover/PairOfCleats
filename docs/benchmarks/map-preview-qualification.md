# Map preview qualification

The FPS and LOD preview launchers distinguish preparation, listener readiness,
complete module-graph admission and rendered-viewer qualification. HTTP module
admission checks same-origin routing, JavaScript MIME types, bounded bytes and
exact installed asset hashes. A listener or complete module graph alone does not
prove rendered frames or measured FPS.

Ordinary CI exercises the portable module-graph and route faults. The explicit
`tests/map/workspace/benchmark-launcher-qualification.js` capsule separately
requires caller-supplied `--playwright`, `--chromium`, `--scenario fps|lod` and
`--out` arguments. It performs an actual small published-index build, invokes the
selected production benchmark launcher, and delegates rendered-frame/diagnostic
checks to `benchmark-browser-qualification.js`. Both scenarios must be run. The
capsule uses the shared subprocess owner with a 30-second outer deadline and
headless browser execution. It neither installs a browser nor falls back to an
author-machine path. Missing prerequisites are failures, never passing skips.

Provide verified existing runtime paths explicitly. Preserve the launcher
readiness JSON and browser receipts/screenshots in the requested output directory
as historical author-workspace evidence. Rendered-frame qualification uses the
declared software renderer and does not qualify hardware throughput or FPS.

The affected canonical preview controls use the explicit
`tests/map/workspace/browser-qualification.js` helper with the same required
`--playwright`, `--chromium` and `--out` arguments. Run both `--scenario three`
and `--scenario three-no-webgl`. These replace the former combined Three
capsule: each creates the same fresh three-source Node/TypeScript witness,
production preview server and browser, with a separate 30-second allowance
including cleanup. The rendered capsule retains desktop and narrow viewports,
private submitted-frame, geometry and pixel checks, keyboard member selection,
segments/focus and exact source-inspector relationship assertions. The source-only
capsule retains the actual injected no-WebGL path, expected diagnostics, source
hierarchy selection and the identical inspector assertions. Retain both receipts;
neither capsule alone covers the former aggregate. The independent shader, noop,
render-exception, module-404 and fallback-page-error controls remain separate.
