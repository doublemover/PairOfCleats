const escapeScript = (value) =>
  String(value || '').replace(/<\/script/gi, '<\\/script');

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
<meta charset="utf-8" />
<title>Code Map Isometric</title>
<style>
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    background: #0f1115;
    color: #f0f0f0;
    font-family: "Segoe UI", Tahoma, sans-serif;
  }
  #app {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  #hud {
    position: absolute;
    top: 12px;
    right: 12px;
    background: rgba(15, 17, 21, 0.85);
    border: 1px solid rgba(255,255,255,0.12);
    padding: 10px 12px;
    border-radius: 8px;
    width: 280px;
    max-width: 280px;
    z-index: 2;
  }
  #hud h1 { font-size: 14px; margin: 0 0 6px; }
  #hud .meta { font-size: 12px; opacity: 0.8; }
  #hud .detail { margin-top: 8px; font-size: 12px; line-height: 1.4; }
  #hud .detail strong { display: block; font-size: 11px; text-transform: uppercase; opacity: 0.6; }
  #selection-body { display: grid; gap: 8px; }
  #selection-body .sel-section { border-top: 1px solid rgba(255,255,255,0.08); padding-top: 6px; }
  #selection-body .sel-section:first-child { border-top: none; padding-top: 0; }
  #selection-body .sel-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.6;
    margin-bottom: 4px;
  }
  #selection-body .sel-row {
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: 6px;
    align-items: start;
    margin-bottom: 3px;
  }
  #selection-body .sel-label { opacity: 0.7; }
  #selection-body .sel-value { word-break: break-word; }
  #selection-body .sel-list { display: flex; flex-wrap: wrap; gap: 4px; }
  #selection-body .sel-pill {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 10px;
  }
  #selection-body .sel-empty { opacity: 0.6; }
  #hud .controls { margin-top: 10px; font-size: 11px; opacity: 0.6; }
  #menu {
    position: absolute;
    left: 12px;
    top: 12px;
    background: rgba(15, 17, 21, 0.9);
    border: 1px solid rgba(255,255,255,0.12);
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 11px;
    min-width: 220px;
    max-width: 280px;
    max-height: 85vh;
    overflow: auto;
    z-index: 2;
    pointer-events: auto;
  }
  #menu details { margin-bottom: 8px; }
  #menu summary {
    font-size: 12px;
    cursor: pointer;
    list-style: none;
    margin-bottom: 6px;
  }
  #menu summary::-webkit-details-marker { display: none; }
  #menu summary::before {
    content: "▸";
    display: inline-block;
    margin-right: 6px;
    transform: translateY(-1px);
  }
  #menu details[open] summary::before { content: "▾"; }
  #menu .section { margin-bottom: 10px; }
  #menu label {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
    cursor: pointer;
  }
  #menu input { accent-color: #4b7bec; }
  #menu .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    display: inline-block;
  }
  #menu .slider-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
  }
  #menu input[type="range"] { width: 100%; }
  #menu .value { opacity: 0.7; font-variant-numeric: tabular-nums; }
  #menu button {
    width: 100%;
    margin-top: 6px;
    background: #1f2a38;
    color: #f0f0f0;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    padding: 6px 8px;
    cursor: pointer;
  }
  #menu button:hover { background: #2a3647; }
  canvas {
    display: block;
    outline: none;
    position: absolute;
    inset: 0;
    z-index: 1;
  }
</style>
</head>
<body>
<div id="app" tabindex="0">
  <div id="hud">
    <h1>Code Map Isometric</h1>
    <div class="meta" id="summary"></div>
    <div class="detail" id="selection">
      <strong>Selection</strong>
      <div id="selection-body">None</div>
    </div>
    <div class="controls">
      Click to focus. WASD to move. Scroll to zoom. Double click to open.
    </div>
  </div>
  <div id="menu">
    <details open>
      <summary>View</summary>
      <div class="section" id="menu-view"></div>
    </details>
    <details>
      <summary>Controls</summary>
      <div class="section" id="menu-controls"></div>
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
<script type="module" src="/isomap/viewer.js"></script>
</body>
</html>`;
}
