export const MAP_BENCH_BUILD_OPTIONS = Object.freeze({
  repo: { type: 'string', describe: 'Repo root.' },
  mode: { type: 'string', default: 'code' },
  'index-root': { type: 'string' },
  scope: { type: 'string', default: 'repo' },
  focus: { type: 'string' },
  include: { type: 'string' },
  'only-exported': { type: 'boolean', default: false },
  collapse: { type: 'string', default: 'none' },
  'max-files': { type: 'number' },
  'max-members-per-file': { type: 'number' },
  'max-edges': { type: 'number' },
  'top-k-by-degree': { type: 'boolean', default: false }
});

export const resolveLimit = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};
