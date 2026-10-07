export const createAstGraphTotals = () => ({
  symbols: 0,
  classes: 0,
  functions: 0,
  imports: 0,
  fileLinks: 0,
  graphLinks: 0
});

export const mergeAstGraphTotals = (target, source) => {
  if (!target || !source) return;
  for (const key of Object.keys(target)) {
    const value = Number(source[key]);
    if (!Number.isFinite(value)) continue;
    target[key] += value;
  }
};

export const sumKindsByPattern = (kindCounts, patterns) => {
  if (!kindCounts || !patterns?.length) return 0;
  let total = 0;
  for (const [kind, count] of Object.entries(kindCounts)) {
    const lowerKind = kind.toLowerCase();
    if (!patterns.some((pattern) => lowerKind.includes(pattern))) continue;
    if (Number.isFinite(Number(count))) total += Number(count);
  }
  return total;
};

export const sumKindCounts = (kindCounts) => {
  if (!kindCounts) return 0;
  let total = 0;
  for (const value of Object.values(kindCounts)) {
    if (Number.isFinite(Number(value))) total += Number(value);
  }
  return total;
};
