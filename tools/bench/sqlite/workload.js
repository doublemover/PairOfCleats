import { createHash } from 'node:crypto';
import { createSqliteBenchBundleFixture, publishSqliteBenchSource } from './shared.js';

const PROFILES = Object.freeze({
  smoke: { files: 12, chunks: 6, tokens: 2, trials: 1, rounds: 1, changed: 1, added: 0, deleted: 0, shrink: 0, grow: 0 },
  lexical: { files: 128, chunks: 64, tokens: 24, trials: 6, rounds: 3, changed: 16, added: 4, deleted: 4, shrink: 4, grow: 4 },
  wide: { files: 256, chunks: 128, tokens: 48, trials: 6, rounds: 3, changed: 32, added: 8, deleted: 8, shrink: 8, grow: 8 }
});
const integer = (value, fallback, min, max, label) => {
  const number = value === undefined ? fallback : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new TypeError(`SQLite benchmark ${label} must be ${min}..${max}.`);
  return number;
};

/** Explicit bounded experiments. Smoke stays cheap; overrides cannot silently
 * retain the preset's qualification label. No runtime production guard changes. */
export const resolveSqliteBenchmarkPlan = (args, operation) => {
  if (!['build', 'update'].includes(operation)) throw new TypeError('Unknown SQLite benchmark operation.');
  if (operation === 'build' && ['rounds', 'changed-files', 'added-files', 'deleted-files', 'shrink-files', 'grow-files'].some(key => args[key] !== undefined)) {
    throw new TypeError('SQLite mutation options apply only to incremental-update.');
  }
  const profile = args.profile === undefined ? 'smoke' : String(args.profile);
  if (!Object.hasOwn(PROFILES, profile)) throw new TypeError('SQLite benchmark profile must be smoke, lexical or wide.');
  const defaults = { ...PROFILES[profile], ...(operation === 'build' && profile === 'smoke' ? { files: 20 } : {}) };
  const plan = { profile, operation,
    fileCount: integer(args.files, defaults.files, operation === 'update' ? 3 : 1, 4096, 'files'),
    chunksPerFile: integer(args.chunks, defaults.chunks, 1, 512, 'chunks'),
    tokensPerChunk: integer(args.tokens, defaults.tokens, 2, 128, 'tokens'),
    vocabularySize: integer(args.vocabulary, 4096, 16, 65536, 'vocabulary'),
    trials: integer(args.trials, defaults.trials, 1, 12, 'trials'),
    rounds: operation === 'build' ? 0 : integer(args.rounds, defaults.rounds, 1, 6, 'rounds'),
    changedFiles: integer(args['changed-files'], defaults.changed, 0, 1024, 'changed-files'),
    addedFiles: integer(args['added-files'], defaults.added, 0, 256, 'added-files'),
    deletedFiles: integer(args['deleted-files'], defaults.deleted, 0, 256, 'deleted-files'),
    shrinkFiles: integer(args['shrink-files'], defaults.shrink, 0, 512, 'shrink-files'),
    growFiles: integer(args['grow-files'], defaults.grow, 0, 512, 'grow-files') };
  const maximumRows = plan.fileCount * plan.chunksPerFile + plan.rounds
    * (plan.addedFiles * plan.chunksPerFile + plan.growFiles * Math.max(1, Math.floor(plan.chunksPerFile / 2)));
  if (maximumRows > 262144 || maximumRows * plan.tokensPerChunk > 4194304) {
    throw new TypeError('SQLite benchmark workload exceeds the explicit row/token allowance.');
  }
  if (operation === 'update' && (plan.shrinkFiles + plan.growFiles > plan.changedFiles
    || plan.changedFiles + plan.addedFiles + plan.deletedFiles === 0
    || plan.fileCount + plan.rounds * (plan.addedFiles - plan.deletedFiles) < 1
    || plan.changedFiles + plan.deletedFiles > plan.fileCount - Math.max(0, plan.deletedFiles - plan.addedFiles) * (plan.rounds - 1))) {
    throw new TypeError('SQLite mutation plan cannot select disjoint existing files for every round.');
  }
  plan.presetShape = plan.fileCount >= defaults.files && plan.chunksPerFile >= defaults.chunks
    && plan.tokensPerChunk >= defaults.tokens && plan.vocabularySize >= 4096
    && (operation === 'build' || plan.rounds >= defaults.rounds && plan.changedFiles >= defaults.changed
      && plan.addedFiles >= defaults.added && plan.deletedFiles >= defaults.deleted
      && plan.shrinkFiles >= defaults.shrink && plan.growFiles >= defaults.grow);
  plan.scope = profile === 'smoke' ? 'smoke' : plan.presetShape ? 'lexical-candidate' : 'custom';
  plan.repeated = plan.trials >= 6;
  plan.lanes = Object.freeze({ sparse: true, dense: false, phrase: false, chargram: false });
  return Object.freeze(plan);
};

const manifestHash = manifest => createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
export const createSqliteBenchmarkWorkload = async ({ bundleDir, plan, sqliteMode = 'code' }) => {
  const fixture = await createSqliteBenchBundleFixture({ bundleDir, ...plan, sqliteMode });
  let manifest = fixture.manifest, rows = plan.fileCount * plan.chunksPerFile;
  const rowCounts = new Map(Object.keys(manifest.files).map(file => [file, plan.chunksPerFile]));
  const initial = { manifest, rows, manifestSha256: manifestHash(manifest) }, rounds = [];
  for (let round = 0; round < plan.rounds; round++) {
    const files = Object.keys(manifest.files).sort();
    const deleted = plan.deletedFiles ? files.slice(-plan.deletedFiles) : [];
    const candidates = files.slice(0, files.length - plan.deletedFiles).slice(0, plan.changedFiles);
    const next = { ...manifest, files: { ...manifest.files } };
    let removedChunks = 0, insertedChunks = 0;
    for (const file of deleted) { removedChunks += rowCounts.get(file); rowCounts.delete(file); delete next.files[file]; }
    const mutations = [];
    for (let index = 0; index < candidates.length + plan.addedFiles; index++) {
      const added = index >= candidates.length;
      const file = added ? `src/added-r${round}-${index - candidates.length}.js` : candidates[index];
      const count = !added && index < plan.shrinkFiles ? Math.max(1, Math.floor(plan.chunksPerFile / 2))
        : !added && index < plan.shrinkFiles + plan.growFiles ? plan.chunksPerFile + Math.max(1, Math.floor(plan.chunksPerFile / 2))
          : plan.chunksPerFile;
      if (!added) removedChunks += rowCounts.get(file);
      const chunks = fixture.buildChunks(file, `r${round + 2}-${index}`, count);
      next.files[file] = await publishSqliteBenchSource({ bundleDir, file, chunks, mtimeMs: 10000 + round * 10000 + index });
      rowCounts.set(file, count);
      insertedChunks += count;
      mutations.push({ file, kind: added ? 'added' : count < plan.chunksPerFile ? 'shrunk' : count > plan.chunksPerFile ? 'grown' : 'changed', chunks: count });
    }
    rows += insertedChunks - removedChunks;
    rounds.push({ ordinal: round + 1, manifest: next, rows, manifestSha256: manifestHash(next),
      changedFiles: mutations.length, deletedFiles: deleted.length, insertedChunks, removedChunks, mutations, deleted });
    manifest = next;
  }
  return { initial, rounds };
};
