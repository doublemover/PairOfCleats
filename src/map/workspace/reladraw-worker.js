import { parse, resolve, render, DARK_THEME } from '/map/vendor/reladraw/index.js';
import { VIEW_LIMITS } from './projection.js';
self.onmessage = ({ data: { source, id } }) => {
  try {
    if (new TextEncoder().encode(source).length > VIEW_LIMITS.sourceBytes) throw new Error('Source exceeds 256 KiB.');
    const ast = parse(source);
    const nodes = ast.statements.filter(statement => statement.kind === 'node');
    const edges = ast.statements.filter(statement => statement.kind === 'edge');
    if (nodes.length > VIEW_LIMITS.nodes || edges.length > VIEW_LIMITS.edges || ast.statements.length > 650) throw new Error('Diagram exceeds 200 nodes / 400 edges / 650 statements.');
    if (ast.statements.some(statement => statement.kind === 'icon')) throw new Error('Custom SVG/file icons are not admitted in embedded diagrams.');
    const layout = resolve(ast);
    if (layout.nodes.length > VIEW_LIMITS.nodes) throw new Error('Expanded diagram exceeds 200 nodes.');
    if (![layout.width, layout.height].every(value => Number.isFinite(value) && value > 0 && value <= 32768)) throw new Error('Layout exceeds the 32768-pixel dimension bound. Narrow or rearrange the story.');
    const svg = render(layout, { theme: DARK_THEME });
    if (svg.length > VIEW_LIMITS.bytes) throw new Error('SVG output exceeds 2 MiB.');
    self.postMessage({ id, svg, layout: { width: layout.width, height: layout.height,
      nodes: layout.nodes.map(node => ({ name: node.name, parent: node.parent?.name ?? null,
        x: node.x, y: node.y, width: node.width, height: node.height })) } });
  } catch (error) { self.postMessage({ id, error: String(error.message || error) }); }
};
