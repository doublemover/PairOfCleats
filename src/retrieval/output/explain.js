const formatExplainLine = (label, parts, color) => {
  const filtered = parts.filter(Boolean);
  if (!filtered.length) return null;
  return color.gray(`   ${label}: `) + filtered.join(', ');
};

export function formatScoreBreakdown(scoreBreakdown, color) {
  if (!scoreBreakdown || typeof scoreBreakdown !== 'object') return [];
  const lines = [];
  const selected = scoreBreakdown.selected || null;
  if (selected) {
    const parts = [];
    if (selected.type) parts.push(`type=${selected.type}`);
    if (Number.isFinite(selected.score)) parts.push(`score=${selected.score.toFixed(4)}`);
    const line = formatExplainLine('Score', parts, color);
    if (line) lines.push(line);
  }
  const sparse = scoreBreakdown.sparse || null;
  if (sparse) {
    const parts = [];
    if (sparse.type) parts.push(`type=${sparse.type}`);
    if (Number.isFinite(sparse.score)) parts.push(`score=${sparse.score.toFixed(4)}`);
    if (Number.isFinite(sparse.k1)) parts.push(`k1=${sparse.k1.toFixed(2)}`);
    if (Number.isFinite(sparse.b)) parts.push(`b=${sparse.b.toFixed(2)}`);
    if (sparse.normalized != null) parts.push(`normalized=${sparse.normalized}`);
    if (sparse.profile) parts.push(`profile=${sparse.profile}`);
    if (Array.isArray(sparse.weights) && sparse.weights.length) {
      const weights = sparse.weights
        .map((value) => (Number.isFinite(value) ? value.toFixed(2) : String(value)))
        .join('/');
      parts.push(`weights=${weights}`);
    }
    const line = formatExplainLine('Sparse', parts, color);
    if (line) lines.push(line);
  }
  const ann = scoreBreakdown.ann || null;
  if (ann) {
    const parts = [];
    if (Number.isFinite(ann.score)) parts.push(`score=${ann.score.toFixed(4)}`);
    if (ann.source) parts.push(`source=${ann.source}`);
    const line = formatExplainLine('ANN', parts, color);
    if (line) lines.push(line);
  }
  const rrf = scoreBreakdown.rrf || null;
  if (rrf) {
    const parts = [];
    if (Number.isFinite(rrf.k)) parts.push(`k=${rrf.k}`);
    if (Number.isFinite(rrf.sparseRank)) parts.push(`sparseRank=${rrf.sparseRank}`);
    if (Number.isFinite(rrf.annRank)) parts.push(`annRank=${rrf.annRank}`);
    if (Number.isFinite(rrf.sparseRrf)) parts.push(`sparseScore=${rrf.sparseRrf.toFixed(4)}`);
    if (Number.isFinite(rrf.annRrf)) parts.push(`annScore=${rrf.annRrf.toFixed(4)}`);
    if (Number.isFinite(rrf.score)) parts.push(`score=${rrf.score.toFixed(4)}`);
    const line = formatExplainLine('RRF', parts, color);
    if (line) lines.push(line);
  }
  const blend = scoreBreakdown.blend || null;
  if (blend) {
    const parts = [];
    if (Number.isFinite(blend.score)) parts.push(`score=${blend.score.toFixed(4)}`);
    if (Number.isFinite(blend.sparseNormalized)) parts.push(`sparseNorm=${blend.sparseNormalized.toFixed(4)}`);
    if (Number.isFinite(blend.annNormalized)) parts.push(`annNorm=${blend.annNormalized.toFixed(4)}`);
    if (Number.isFinite(blend.sparseWeight) || Number.isFinite(blend.annWeight)) {
      const sparseWeight = Number.isFinite(blend.sparseWeight) ? blend.sparseWeight.toFixed(2) : '0.00';
      const annWeight = Number.isFinite(blend.annWeight) ? blend.annWeight.toFixed(2) : '0.00';
      parts.push(`weights=${sparseWeight}/${annWeight}`);
    }
    const line = formatExplainLine('Blend', parts, color);
    if (line) lines.push(line);
  }
  const phrase = scoreBreakdown.phrase || null;
  if (phrase) {
    const parts = [];
    if (Number.isFinite(phrase.matches)) parts.push(`matches=${phrase.matches}`);
    if (Number.isFinite(phrase.boost)) parts.push(`boost=${phrase.boost.toFixed(4)}`);
    if (Number.isFinite(phrase.factor)) parts.push(`factor=${phrase.factor.toFixed(2)}`);
    const line = formatExplainLine('Phrase', parts, color);
    if (line) lines.push(line);
  }
  const symbol = scoreBreakdown.symbol || null;
  if (symbol) {
    const parts = [];
    if (typeof symbol.definition === 'boolean') parts.push(`definition=${symbol.definition}`);
    if (typeof symbol.export === 'boolean') parts.push(`export=${symbol.export}`);
    if (Number.isFinite(symbol.factor)) parts.push(`factor=${symbol.factor.toFixed(2)}`);
    if (Number.isFinite(symbol.boost)) parts.push(`boost=${symbol.boost.toFixed(4)}`);
    const line = formatExplainLine('Symbol', parts, color);
    if (line) lines.push(line);
  }
  return lines;
}
