const formatExplainLine = (label, parts, color) => {
  const filtered = parts.filter(Boolean);
  if (!filtered.length) return null;
  const prefix = `   ${label}: `;
  if (color?.gray && typeof color.gray === 'function') {
    return color.gray(prefix) + filtered.join(', ');
  }
  return prefix + filtered.join(', ');
};

const formatScorePiece = (label, parts, color) => {
  if (!parts.length) return '';
  return `${label}=${parts.join(',')}`;
};

export function formatScoreBreakdown(scoreBreakdown, color) {
  if (!scoreBreakdown || typeof scoreBreakdown !== 'object') return [];
  const parts = [];
  const selected = scoreBreakdown.selected || null;
  if (selected) {
    const entry = [];
    if (selected.type) entry.push(selected.type);
    if (Number.isFinite(selected.score)) entry.push(selected.score.toFixed(3));
    const piece = formatScorePiece('Score', entry, color);
    if (piece) parts.push(piece);
  }
  const sparse = scoreBreakdown.sparse || null;
  if (sparse) {
    const entry = [];
    if (sparse.type) entry.push(sparse.type);
    if (Number.isFinite(sparse.score)) entry.push(sparse.score.toFixed(3));
    const piece = formatScorePiece('Sparse', entry, color);
    if (piece) parts.push(piece);
  }
  const ann = scoreBreakdown.ann || null;
  if (ann) {
    const entry = [];
    if (ann.source) entry.push(ann.source);
    if (Number.isFinite(ann.score)) entry.push(ann.score.toFixed(3));
    const piece = formatScorePiece('ANN', entry, color);
    if (piece) parts.push(piece);
  }
  const rrf = scoreBreakdown.rrf || null;
  if (rrf && Number.isFinite(rrf.score)) {
    const piece = formatScorePiece('RRF', [rrf.score.toFixed(3)], color);
    if (piece) parts.push(piece);
  }
  const symbol = scoreBreakdown.symbol || null;
  if (symbol) {
    const entry = [];
    if (typeof symbol.definition === 'boolean') entry.push(symbol.definition ? 'def' : 'nodef');
    if (typeof symbol.export === 'boolean') entry.push(symbol.export ? 'exp' : 'noexp');
    if (Number.isFinite(symbol.factor)) entry.push(`x${symbol.factor.toFixed(2)}`);
    const piece = formatScorePiece('Symbol', entry, color);
    if (piece) parts.push(piece);
  }
  const relation = scoreBreakdown.relation || null;
  if (relation && relation.enabled !== false) {
    const entry = [];
    if (Number.isFinite(relation.callMatches)) entry.push(`call=${relation.callMatches}`);
    if (Number.isFinite(relation.usageMatches)) entry.push(`use=${relation.usageMatches}`);
    if (Number.isFinite(relation.boost)) entry.push(`+${relation.boost.toFixed(3)}`);
    const piece = formatScorePiece('Relation', entry, color);
    if (piece) parts.push(piece);
  }
  const graph = scoreBreakdown.graph || null;
  if (graph) {
    const entry = [];
    if (Number.isFinite(graph.score)) entry.push(graph.score.toFixed(3));
    if (Number.isFinite(graph.degree)) entry.push(`deg=${graph.degree}`);
    if (Number.isFinite(graph.proximity)) entry.push(`prox=${graph.proximity}`);
    const piece = formatScorePiece('Graph', entry, color);
    if (piece) parts.push(piece);
  }
  if (!parts.length) return [];
  const prefix = '   Scores: ';
  if (color?.gray && typeof color.gray === 'function') {
    return [color.gray(prefix) + parts.join(' | ')];
  }
  return [prefix + parts.join(' | ')];
}
