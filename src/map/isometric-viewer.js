const escapeScript = (value) => String(value || '').replace(/<\/script/gi, '<\\/script');

export function renderIsometricHtml({
  mapModel,
  threeUrl,
  openUriTemplate,
  viewerConfig = {}
}) {
  const mapJson = escapeScript(JSON.stringify(mapModel || {}));
  const config = {
    threeUrl: threeUrl || '',
    openUriTemplate: openUriTemplate || '',
    ...viewerConfig
  };
  const configJson = escapeScript(JSON.stringify(config));

  return `<!doctype html>
<html lang="en">
<head>
<link rel="icon" href="data:," />
<meta charset="utf-8" />
<title>PairOfCleats · Semantic stacks</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #0f1115; color: #f0f0f0; font-family: "Segoe UI", Tahoma, sans-serif; }
  #app { position: relative; width: 100%; height: 100%; overflow: hidden; }
  #hud { position: absolute; top: 12px; right: 12px; background: rgba(15, 17, 21, 0.85); border: 1px solid rgba(255,255,255,0.12); padding: 10px 12px; border-radius: 8px; width: 280px; max-width: 280px; z-index: 2; }
  #hud h1 { font-size: 14px; margin: 0 0 6px; }
  #hud .meta { font-size: 12px; opacity: 0.8; }
  #hud .detail { margin-top: 8px; font-size: 12px; line-height: 1.4; }
  #hud .detail strong { display: block; font-size: 11px; text-transform: uppercase; opacity: 0.6; }
  #selection-body { display: grid; gap: 8px; }
  #selection-body .sel-section { border-top: 1px solid rgba(255,255,255,0.08); padding-top: 6px; }
  #selection-body .sel-section:first-child { border-top: none; padding-top: 0; }
  #selection-body .sel-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; margin-bottom: 4px; }
  #selection-body .sel-row { display: grid; grid-template-columns: 90px 1fr; gap: 6px; align-items: start; margin-bottom: 3px; }
  #selection-body .sel-label { opacity: 0.7; }
  #selection-body .sel-value { word-break: break-word; }
  #selection-body .sel-list { display: flex; flex-wrap: wrap; gap: 4px; }
  #selection-body .sel-pill { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; padding: 1px 4px; font-size: 10px; }
  #selection-body .sel-empty { opacity: 0.6; }
  #hud .controls { margin-top: 10px; font-size: 11px; opacity: 0.6; }
  #perf-hud { margin-top: 8px; font-size: 11px; font-family: Consolas, Monaco, monospace; background: rgba(255,255,255,0.06); border-radius: 6px; padding: 6px 8px; display: none; }
  #menu { position: absolute; left: 12px; top: 12px; background: rgba(15, 17, 21, 0.9); border: 1px solid rgba(255,255,255,0.12); padding: 10px 12px; border-radius: 8px; font-size: 11px; min-width: 220px; max-width: 280px; max-height: 85vh; overflow: auto; z-index: 2; pointer-events: auto; }
  #menu details { margin-bottom: 8px; }
  #menu summary { font-size: 12px; cursor: pointer; list-style: none; margin-bottom: 6px; }
  #menu summary::-webkit-details-marker { display: none; }
  #menu summary::before { content: "▸"; display: inline-block; margin-right: 6px; transform: translateY(-1px); }
  #menu details[open] summary::before { content: "▾"; }
  #menu .section { margin-bottom: 10px; }
  #menu label { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; cursor: pointer; }
  #menu input { accent-color: #4b7bec; }
  #menu .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  #menu .slider-row { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center; margin-bottom: 6px; }
  #menu input[type="range"] { width: 100%; }
  #menu .value { opacity: 0.7; font-variant-numeric: tabular-nums; }
  #menu button { width: 100%; margin-top: 6px; background: #1f2a38; color: #f0f0f0; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 6px 8px; cursor: pointer; }
  #menu button:hover { background: #2a3647; }
  canvas { display: block; outline: none; position: absolute; inset: 0; z-index: 1; }
  :root { color-scheme: dark; }
  html,body { background:#0c1520; color:#dce7f5; font-family:Inter,"Segoe UI",system-ui,sans-serif; }
  #stack-bar { position:absolute; inset:0 0 auto; height:56px; z-index:3; display:flex; align-items:center; gap:10px; padding:0 14px; background:#101e2eee; border-bottom:1px solid #31435a; }
  #stack-bar strong { font-size:15px; letter-spacing:.02em; margin-right:auto; }
  #stack-bar button,#stack-bar select,#stack-tree button { background:#1c3045; border:1px solid #3d536c; border-radius:6px; padding:7px 9px; color:inherit; cursor:pointer; }
  button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible { outline:2px solid #64decc; outline-offset:2px; }
  button:disabled { opacity:.4; cursor:default; }
  #hud { top:70px; right:14px; width:266px; max-width:266px; max-height:calc(100% - 115px); overflow:auto; background:#101e2eef; border-color:#31435a; box-shadow:0 8px 24px #0005; }
  #hud h1 { font-size:15px; color:#93e6d9; }
  #menu { top:70px; left:14px; width:220px; min-width:0; max-height:calc(100% - 115px); background:#101e2eef; border-color:#31435a; box-shadow:0 8px 24px #0005; }
  #stack-search { box-sizing:border-box; width:100%; padding:9px; color:inherit; border:1px solid #3d536c; border-radius:6px; background:#17293b; }
  #stack-tree { max-height:34vh; overflow:auto; margin:10px 0; }
  #stack-tree summary { overflow-wrap:anywhere; line-height:1.5; }
  #stack-tree button { text-align:left; font-size:11px; margin-top:4px; }
  #stack-legend { display:grid; gap:5px; font-size:11px; margin:8px 0; }
  #stack-breadcrumb { color:#a9bfd4; font-size:11px; line-height:1.5; overflow-wrap:anywhere; }
  #stack-status { position:absolute; bottom:0; left:0; right:0; z-index:3; padding:8px 14px; background:#0c1520ee; border-top:1px solid #31435a; font:11px ui-monospace,monospace; }
  #selection-body button { color:#a9e7e0; border:1px solid #35526b; border-radius:5px; background:#182c40; padding:7px; text-align:left; overflow-wrap:anywhere; }
  #selection-body details { border-top:1px solid #31435a; padding-top:7px; }
  #selection-body summary { cursor:pointer; overflow-wrap:anywhere; }
  #selection-body .evidence { padding-left:8px; overflow-wrap:anywhere; }
  .stack-help { font-size:11px; line-height:1.55; color:#a9bfd4; }
  @media(max-width:850px) { #stack-bar strong { font-size:12px; } #stack-bar { gap:5px; padding:0 8px; } #stack-bar button { padding:6px; } #hud { width:205px; right:8px; } #menu { width:176px; left:8px; } }
  @media(max-width:600px) { #stack-bar { height:auto; min-height:54px; flex-wrap:wrap; padding:8px; } #stack-bar strong { width:100%; } #menu { top:100px; max-height:24vh; width:40%; } #hud { top:auto; bottom:35px; right:8px; left:8px; width:auto; max-width:none; max-height:27vh; } #stack-tree { max-height:16vh; } #stack-status { font-size:10px; } }
  [hidden] { display:none!important; }
  .scene-first-workspace #stack-bar { height:auto; min-height:56px; box-sizing:border-box; flex-wrap:wrap; padding:10px 14px; gap:8px; background:#071423f5; }
  .scene-first-workspace #stack-bar strong { color:#84e9ff; }
  .viewer-scope-chip { font-size:11px; color:#b0c8dd; max-width:360px; line-height:1.4; }
  .scene-first-workspace #menu,.scene-first-workspace #hud { box-sizing:border-box; top:calc(var(--viewer-header-height,56px) + 12px); bottom:auto; width:min(380px,calc(100% - 28px)); max-width:380px; max-height:calc(100% - var(--viewer-header-height,56px) - 90px); background:#09192bf5; border-color:#294e72; }
  .scene-first-workspace #menu { left:14px; }
  .scene-first-workspace #hud { right:14px; left:auto; }
  .viewer-task-heading { display:flex; align-items:center; gap:8px; position:sticky; top:0; z-index:1; background:#09192b; padding:5px 0 10px; }
  #menu .viewer-task-heading button { width:auto; margin:0; }
  .viewer-task-heading strong { margin-right:auto; font-size:15px; }
  .scene-first-workspace #stack-tree { max-height:none; overflow:visible; }
  .scene-first-workspace #selection-body { font-size:12px; line-height:1.5; }
  .scene-first-workspace .slider-row { min-height:28px; }
  #viewer-save-status { border-top:1px solid #294e72; padding-top:8px; color:#a9bfd4; }
  .appearance-composition { padding:4px 0 14px; }
  .appearance-composition p { color:#b0c8dd; line-height:1.5; }
  #viewer-help { max-width:620px; max-height:75vh; overflow:auto; background:#09192b; color:#e4effa; border:1px solid #3f87b2; border-radius:12px; padding:24px; }
  #viewer-help::backdrop { background:#020810b3; }
  #viewer-help p { line-height:1.7; }
  @media(max-width:600px) { .scene-first-workspace #menu,.scene-first-workspace #hud { left:8px; right:8px; width:calc(100% - 16px); max-width:none; max-height:calc(100% - var(--viewer-header-height,56px) - 70px); }.viewer-scope-chip { max-width:100%; } }
</style>
</head>
<body>
<div id="app" tabindex="0">
  <div id="stack-bar"><strong>PairOfCleats / semantic stacks</strong><button id="stack-back" disabled aria-label="Previous selection">←</button><button id="stack-forward" disabled aria-label="Next selection">→</button><button id="stack-home">Fit all</button><button id="stack-focus">Focus selection</button><label>Scale <select id="stack-mode"><option value="auto">Auto</option><option value="pipeline">Pipeline</option><option value="stacks">Stacks</option><option value="segments">Segments</option></select></label></div>
  <div id="stack-status" role="status">Loading bounded source model…</div>
  <div id="hud">
    <h1>Evidence inspector</h1><div id="stack-breadcrumb">Select a stack or segment</div>
    <div class="meta" id="summary"></div>
    <div class="detail" id="selection">
      <strong>Selection</strong>
      <div id="selection-body">None</div>
    </div>
    <div id="perf-hud"></div>
    <div class="controls">Drag or WASD to pan. Scroll to zoom. F focuses selection; Home fits all; Esc clears. Double click opens source.</div>
  </div>
  <div id="menu">
    <details open><summary>Source hierarchy</summary><input id="stack-search" aria-label="Find stack or segment" placeholder="Find stack or segment"><div id="stack-tree"></div></details>
    <div id="stack-legend" aria-label="Segment shape and color legend"></div><button id="stack-plumbing">Inspect current plumbing</button>
    <p class="stack-help">One source member per segment. Plates group files by directory. Pipes preserve dependency direction; they do not imply runtime execution order.</p>
    <label><input id="stack-all-edges" type="checkbox">All admitted segment links</label>
    <details open>
      <summary>View</summary>
      <div class="section" id="menu-view"></div>
    </details>
    <details>
      <summary>Controls</summary>
      <div class="section" id="menu-controls"></div>
    </details>
    <details>
      <summary>Performance</summary>
      <div class="section" id="menu-performance"></div>
    </details>
    <details>
      <summary>Edges</summary>
      <div class="section" id="menu-edges"></div>
    </details>
    <details open>
      <summary>Layout</summary>
      <div class="section" id="menu-layout"></div>
    </details>
    <details>
      <summary>Scoring</summary>
      <div class="section" id="menu-score"></div>
    </details>
    <details>
      <summary>Hue / Saturation / Light</summary>
      <div class="section" id="menu-colors"></div>
    </details>
    <details>
      <summary>Color Mode</summary>
      <div class="section" id="menu-color-mode"></div>
    </details>
    <details open>
      <summary>Visuals</summary>
      <div class="section" id="menu-visuals"></div>
    </details>
    <details open>
      <summary>Effects</summary>
      <div class="section" id="menu-effects"></div>
    </details>
    <div class="section" id="menu-actions"></div>
  </div>
</div>
<script type="application/json" id="map-data">${mapJson}</script>
<script type="application/json" id="viewer-config">${configJson}</script>
<script type="importmap">${escapeScript(JSON.stringify({imports:{three:config.threeUrl || "/three/three.module.js"}}))}</script>
<script>window.addEventListener('error',function(event){var status=document.getElementById('stack-status');if(status)status.textContent='Viewer startup error: '+(event.message||'A required asset could not load.');});window.addEventListener('unhandledrejection',function(event){var status=document.getElementById('stack-status');if(status)status.textContent='Viewer error: '+String(event.reason&&event.reason.message||event.reason);});</script>
<script type="module" src="/isomap/viewer.js"></script>
</body>
</html>`;
}
