const NS = 'http://www.w3.org/2000/svg';
const tags = new Set(['svg', 'a', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'marker', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc']);
const attributes = new Set(['viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'dx', 'dy', 'id', 'offset', 'stop-color', 'stop-opacity', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'marker-start', 'marker-end']);
/** Rebuild SVG from a strict inert subset. No link, style, event handler or external resource survives. */
export function safeSvg(source) {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) throw new Error('Invalid SVG from compiler.');
  const clone = input => {
    if (input.nodeType === 3) return document.createTextNode(input.textContent);
    if (input.namespaceURI !== NS || !tags.has(input.localName)) return null;
    const node = document.createElementNS(NS, input.localName === 'a' ? 'g' : input.localName);
    for (const attribute of input.attributes) {
      if (!attributes.has(attribute.name)) continue;
      if (/url\s*\(/i.test(attribute.value) && !/^url\(#[A-Za-z0-9_-]+\)$/.test(attribute.value)) continue;
      node.setAttribute(attribute.name, attribute.value);
    }
    for (const child of input.childNodes) { const next = clone(child); if (next) node.append(next); }
    return node;
  };
  const svg = clone(parsed.documentElement); if (!svg || svg.localName !== 'svg') throw new Error('Expected SVG root.');
  return svg;
}
export function mountDiagram(host, compiled, bindings, onSelect) {
  const svg = safeSvg(compiled.svg);
  svg.style.width = `${Math.max(500, compiled.layout.width)}px`;
  svg.style.height = `${Math.max(300, compiled.layout.height)}px`;
  const targets = new Map();
  // Parent overlays first so children remain pickable.
  const nodes = [...compiled.layout.nodes].sort((a, b) => a.name.split('.').length - b.name.split('.').length);
  for (const node of nodes) {
    const binding = bindings[node.name]; if (!binding) continue;
    const rect = document.createElementNS(NS, 'rect');
    for (const key of ['x', 'y', 'width', 'height']) rect.setAttribute(key, node[key]);
    rect.setAttribute('fill', 'transparent'); rect.setAttribute('stroke', 'transparent'); rect.setAttribute('stroke-width', '3');
    rect.setAttribute('tabindex', '0'); rect.setAttribute('role', 'button'); rect.setAttribute('aria-label', binding.label);
    rect.dataset.entityId = binding.id; rect.classList.add('pick-target');
    rect.addEventListener('click', () => onSelect(binding.id));
    rect.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(binding.id); } });
    svg.append(rect); targets.set(binding.id, rect);
  }
  host.replaceChildren(svg);
  return { svg, zoom(scale) {
    svg.style.width = `${Math.max(100, compiled.layout.width * scale)}px`;
    svg.style.height = `${Math.max(100, compiled.layout.height * scale)}px`;
  }, select(id) {
    for (const [key, node] of targets) node.setAttribute('stroke', key === id ? '#fbbf24' : 'transparent');
    targets.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  } };
}
