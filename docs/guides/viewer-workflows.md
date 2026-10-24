# Open a bounded map or evidence workspace

Use a verified Node26 application checkout and a compatible published code index
for an explicitly selected target. These are two existing viewer workflows plus
report export; a renderer-replacement proposal is not a shipped replacement.

## Choose output and open Semantic stacks

`node bin/pairofcleats.js report map --repo <target> --format json` writes a bounded
map model; `--format dot` writes Graphviz input. SVG/HTML rendering requires a
qualified Graphviz `dot` installation and its runtime/plugins. Missing Graphviz
does not make an explicitly requested SVG successful; deliberately choose DOT
if you want to render elsewhere. JSON/DOT do not require Graphviz.

The Three.js HTML-ISO viewer uses the canonical report preview option:

```sh
node bin/pairofcleats.js report map --serve --repo "path/to/your-project" --no-open
```

Open the URL from the `map-preview-ready` JSON event. The default is HTTP on
`127.0.0.1`; the listener does not generate certificates or change trust stores.
Search a loaded source entity, select its file/member,
inspect source/relationship evidence, focus it, then use Back/Forward to return.
Use the existing scope/display controls to keep the view bounded. Missing or
unresolved endpoints remain labeled; a drawn subset is not complete source
coverage. Each running session pins its selected document and local modules;
later exports/current-pointer changes do not switch it. Restart explicitly to
select another generation. Stop the owned server through ordinary terminal
cancellation and wait for shutdown.

Open saved map model JSON or generated HTML evidence without reading a current
index:

```sh
node bin/pairofcleats.js report map --serve --input "saved map.json" --no-open
```

The input is preserved. Saved HTML contributes only a recognized JSON payload;
its scripts are not executed. Unsupported report summaries/raw index artifacts
are rejected. Saved snapshot provenance is retained without claiming current
index health. See [preview and saved-input contracts](map-preview.md) for
publication, session identity, supported inputs and preference authority.

## Open the API evidence workspace

```sh
node bin/pairofcleats.js service api --repo "path/to/your-project" --json
```

Use the startup response's `mapWorkspaceUrl`, on the printed local origin. Enter
a required bearer token in the workspace's memory-only token field. Choose
**Query index**, select the catalog and request your selected repository. Inspect
an available logical artifact, follow its source/generation provenance and page
through its bounded rows. Where a semantic row offers detail, follow that exact
generation, then use history to return to the original response/page.

**Open output** reads a bounded local JSON report/query response in the browser;
it does not upload the file. Use only exports the current UI provides. Enrichment
actions that are plan-only remain plan-only; a displayed task card is not proof
of an executed build. Stop the owned API process through its documented shutdown
or terminal cancellation and wait for readers/workers to settle.

## Read coverage and qualification precisely

Source admission, query omission, display scope and GPU draw admission are
separate counts. Artifact catalogs enumerate names and availability; inventory
completeness is not an independent E2E test for every artifact. Generation-pinned
pages/cursors cannot be mixed with current data after replacement. Unsupported
binary formats show bounded provenance instead of invented architecture nodes.
Respect the existing source-data/event retention and endpoint limits in
[the workspace reference](reladraw-workspace.md).

The [map guide](code-maps.md) owns current display/draw limits and
[Reladraw reference](reladraw-workspace.md) preserves the exact October12
Chromium/service/Worker software-WebGL qualification and its unqualified workflows.
CPU/DOM fixtures, software WebGL and representative hardware GPU/performance
acceptance are different evidence. October22 source changes are **UNVALIDATED**;
they do not inherit earlier browser or latency qualification. The
[active roadmap](../roadmap.md) owns deferred replacement work. No private planning
Page is needed to follow this guide, and no replacement/performance result is
claimed here.
