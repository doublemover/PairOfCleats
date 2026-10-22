# Code maps

PairOfCleats can generate **code maps** from your indexed repository. A map is a graph model that can be exported as:

- **JSON** (map model)
- **Graphviz DOT** (graph definition)
- **SVG** or **HTML** (rendered via Graphviz)
- **HTML-ISO** (isometric 3D viewer powered by three.js)

The map model is derived from the same indexed metadata used for search (imports, exports, calls, usages, dataflow, etc.).

## CLI usage

Generate a map report (writes artifacts to disk and prints a JSON report):

```bash
pairofcleats report map --format json
pairofcleats report map --format dot
pairofcleats report map --format svg
pairofcleats report map --format html
pairofcleats report map --format html-iso
```

Useful options (subset):

- `--scope repo|dir|file|symbol`
- `--focus <path | folder | file::symbol>`
- `--include imports,calls,usages,dataflow,exports`
- Guardrails: `--max-files`, `--max-members-per-file`, `--max-edges`, `--top-k-by-degree`

`--index-root <build-root>` selects that root's `index-<mode>` artifacts. Report
caches bind the canonical selected path, complete pieces-manifest identity and
map producer version. Switching roots or replacing a selected generation does
not require `--refresh`. An unreadable/incompatible manifest fails before cache
admission; a generation changed during the report fails without publishing a
new cached model. The default cache remains outside source, under the repository
cache root; `--cache-dir` selects an explicit cache destination.

## Interactive evidence workspace

Run `pairofcleats service api --repo /your/repository` and open the printed `/map/workspace`
URL. The integrated Reladraw workspace reads the published artifact catalog, bounded artifact
pages and existing search/analysis queries. Exported map JSON and report JSON can also be opened
locally. See [coverage, controls and verification limits](reladraw-workspace.md).
This workspace does not replace `map-iso`; both consume the same indexed metadata.

## Graphviz is optional

PairOfCleats can always produce **DOT** output (and the JSON map model) without Graphviz.

Graphviz is only required when you request rendered formats:

- `format=svg`
- `format=html`

If Graphviz is not installed or `dot` is not on your `PATH`, these formats will fail (or the API may downgrade to DOT when possible).

### DOT-only mode

If you do not want Graphviz installed on the same machine, you can work in "DOT-only" mode:

1) Produce DOT:

```bash
pairofcleats report map --format dot --out map.dot
```

2) Render later (any machine with Graphviz installed):

```bash
dot -Tsvg map.dot > map.svg
# or
 dot -Tpng map.dot > map.png
```

This workflow is also useful for CI environments where installing Graphviz is undesirable.


## Semantic stacks (Three.js)

`node tools/analysis/map-iso-serve.js --repo /your/repository --no-open` serves the existing HTML-ISO
viewer. The default layout is now **Semantic stacks**; older stored preferences can be
changed under Layout. Existing report generation, display limits, source IDs, instancing,
selection and controls remain the owners. No separate product or backend is required.

- Each member is one colored geometric segment: teal cylinders for functions/methods,
  violet blocks for types/classes, amber tapered segments for values/fields, gray for unknowns.
  Color describes kind, not inferred quality or runtime frequency.
- Segments stack in source order on a file plate; long files use additional 20-segment columns.
  Directory trays form the larger hierarchy. No decorative chunks pretend to be source records.
- Segment pipes join exact source endpoints. Stack pipes aggregate those same admitted edges
  by file and relation type. Pipeline pipes aggregate cross-directory dependencies. Direction
  is indicated at the target port. This is dependency plumbing, not asserted execution order.
- Auto semantic zoom uses projected stack width with hysteresis. The Scale menu also selects
  Pipeline, Stacks or Segments explicitly. At segment scale only the selected entity's links
  are shown by default; “All admitted segment links” is an explicit bounded overview.
- Search the loaded hierarchy, expand members on demand, use Back/Forward, Fit all or Focus
  selection. `F` focuses, `Home` fits, `Esc` clears. WASD panning is scaled to the visible world.
  Keyboard input in search/settings fields does not move the scene.
- The inspector retains the original metadata through a lazy field tree and pages directed
  relationship evidence. Source/target buttons navigate only to drawn endpoints; unavailable
  endpoints are labeled instead of fabricated.

Hard draw admission is 500 files, 12,000 members and 16,000 source edges (normally further
restricted by the existing 60-file / 20-member / 400-edge display defaults). Omitted members,
unresolved endpoints and display scope are retained separately. Relationship geometry is
batched by type and scale and replaced on focus changes; repeated rebuilds dispose old GPU
resources and restore resident selection. The legacy layouts remain available.

The delivery path now serves the exact shared browser helper modules used by the client and
provides the Three.js import map required by example modules. Fresh local TLS generation awaits
the installed async selfsigned API. These fixes are part of the existing map-iso launcher.
The top-level wrapper does not currently expose a `map-iso` subcommand; use the launcher above.

Verification: real Three.js CPU geometry and matrices, multiscale evidence aggregation,
DOM-emulated search/focus/history/plumbing inspection, LOD hysteresis, caps, source-module resolution and repeated
resource disposal. A disposable published-index fixture also launches the real map-iso process,
verifies its generated TLS certificate and retrieves the actual HTML/client/shared modules.
These tests do not establish WebGL performance, label occlusion, mobile
usability, native pointer picking or real-browser interaction. The owner requested continuing
with alternate validation rather than asking for browser sign-in/setup.

Workspace local paging materializes details only for admitted rows and reuses the
validated first-page projection. Relationship options describe the complete
loaded response, so later-page types remain selectable. Returning to a retained
selection restores its overview and currently filtered relationships without
adding history or loading remote detail automatically.

Stack selection summaries and relationship actions share explicit file/member
endpoint ownership, including member ID zero. Full-level pipe geometry remains
owned by its admitted model; selection-only updates reuse it. Filtered segment
geometry changes only with its effective row subset, and full rebuilds retire
both geometry forms. Hover moves coalesce to the latest pointer per render
frame, with explicit camera/culling/visibility invalidation and disposal. These
are implementation contracts; authored CPU/DOM fixtures do not establish
browser responsiveness, GPU/FPS or retained-memory improvements.