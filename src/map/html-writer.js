const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function renderSvgHtml({ svg, mapModel, title = 'Code Map' }) {
  const warnings = Array.isArray(mapModel?.warnings) ? mapModel.warnings : [];
  const summary = mapModel?.summary || {};
  const legend = mapModel?.legend || {};
  const svgPayload = svg ? encodeURIComponent(svg) : '';
  const svgContent = svgPayload
    ? `<img alt="Code map" src="data:image/svg+xml;utf8,${svgPayload}" />`
    : '';
  const badgeList = Object.entries(legend.functionBadges || {})
    .map(([key, label]) => `<span><strong>${escapeHtml(label)}</strong> ${escapeHtml(key)}</span>`)
    .join(' ');
  const edgeList = Object.entries(legend.edgeStyles || {})
    .map(([key, style]) => `<span><strong>${escapeHtml(key)}</strong> ${escapeHtml(style.style || '')}</span>`)
    .join(' ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; background: #f7f7f7; color: #222; }
  header { padding: 12px 16px; background: #111; color: #f8f8f8; }
  .meta { font-size: 12px; opacity: 0.8; }
  .content { display: grid; grid-template-columns: 1fr 260px; gap: 12px; padding: 12px; }
  .panel { background: #fff; border-radius: 8px; padding: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
  .panel h3 { margin: 0 0 6px; font-size: 14px; }
  .legend span { display: block; font-size: 12px; margin-bottom: 4px; }
  .warnings { color: #b33939; font-size: 12px; margin-top: 6px; }
  .svg-wrap { overflow: auto; background: #fff; border-radius: 8px; padding: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
  svg { width: 100%; height: auto; }
</style>
</head>
<body>
  <header>
    <div>${escapeHtml(title)}</div>
    <div class="meta">files: ${summary.counts?.files || 0} | members: ${summary.counts?.members || 0} | edges: ${summary.counts?.edges || 0}</div>
  </header>
  <div class="content">
    <div class="svg-wrap">${svgContent}</div>
    <div class="panel">
      <h3>Legend</h3>
      <div class="legend"><strong>Badges</strong>${badgeList}</div>
      <div class="legend" style="margin-top: 8px;"><strong>Edges</strong>${edgeList}</div>
      ${warnings.length ? `<div class="warnings">${warnings.map(escapeHtml).join('<br />')}</div>` : ''}
    </div>
  </div>
</body>
</html>`;
}
