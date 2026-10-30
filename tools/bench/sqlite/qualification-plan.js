import { resolveSqliteBenchmarkPlan } from './workload.js';

export const SQLITE_ROW_QUALIFICATION_SHAPES = Object.freeze(['small-low', 'large-low', 'large-high']);
export const sqliteRowQualificationPlan = shape => {
  if (!SQLITE_ROW_QUALIFICATION_SHAPES.includes(shape)) throw new TypeError('Unknown private SQLite qualification shape.');
  const high = shape === 'large-high';
  const args = { profile: 'lexical', files: shape === 'small-low' ? 32 : 328, chunks: 512,
    tokens: 8, vocabulary: 4096, trials: 6, rounds: 3, 'changed-files': high ? 96 : 3,
    'added-files': high ? 8 : 1, 'deleted-files': high ? 8 : 1, 'shrink-files': high ? 16 : 1, 'grow-files': high ? 16 : 1 };
  return resolveSqliteBenchmarkPlan(Object.fromEntries(Object.entries(args).map(([key,value]) => [key,String(value)])), 'update');
};

export const assertSqliteRowQualificationWork = (workload, shape) => {
  const plan = sqliteRowQualificationPlan(shape), expected = plan.fileCount * 512, inserted = shape === 'large-high' ? 53248 : 2048;
  if (workload.initial.rows !== expected || Object.keys(workload.initial.manifest.files).length !== plan.fileCount || workload.rounds.length !== 3) {
    throw new Error('SQLite qualification initial/round cardinality differs from the declared independent shape.');
  }
  for (const round of workload.rounds) {
    if (round.rows !== expected || round.insertedChunks !== inserted || round.changedFiles !== plan.changedFiles + plan.addedFiles
      || round.deletedFiles !== plan.deletedFiles || (round.changedFiles + round.deletedFiles) / plan.fileCount > 0.35
      || round.mutations.filter(row => row.kind === 'shrunk').length !== plan.shrinkFiles
      || round.mutations.filter(row => row.kind === 'grown').length !== plan.growFiles
      || round.mutations.filter(row => row.kind === 'added').length !== plan.addedFiles) {
      throw new Error('SQLite qualification mutations do not preserve their admitted guard/row shape.');
    }
  }
};
