import { resolveSqliteBenchmarkPlan } from './workload.js';

export const SQLITE_ROW_QUALIFICATION_SHAPES = Object.freeze(['small-low', 'large-low', 'large-high']);
export const SQLITE_ROW_QUALIFICATION_COHORTS = Object.freeze([
  'small-low-build', 'small-low-update', 'large-low-build', 'large-low-update', 'large-high-update'
]);

/** Internal campaign selection retains every paired trial and update round.
 * It does not partition a native operation or change any child's deadline.
 */
export const selectSqliteRowQualification = (cohort = 'all') => {
  if (cohort !== 'all' && !SQLITE_ROW_QUALIFICATION_COHORTS.includes(cohort)) throw new TypeError('Unknown SQLite qualification cohort.');
  const pairs = [];
  for (let trial = 1; trial <= 6; trial++) {
    const shapes = trial % 2 ? SQLITE_ROW_QUALIFICATION_SHAPES : [...SQLITE_ROW_QUALIFICATION_SHAPES].reverse();
    for (const shape of shapes) for (const operation of shape === 'large-high' ? ['update'] : ['build', 'update']) {
      if (cohort === 'all' || cohort === shape + '-' + operation) pairs.push({ shape, operation, trial });
    }
  }
  // Large/high and large/low must still prove that their initial manifests
  // match; selecting one arm cannot discard that original input assertion.
  const shapes = cohort === 'all' ? [...SQLITE_ROW_QUALIFICATION_SHAPES]
    : cohort.startsWith('small-') ? ['small-low'] : ['large-low', 'large-high'];
  return { cohort, scope: cohort === 'all' ? 'complete-campaign' : 'selected-cohort', shapes, pairs,
    omittedCohorts: SQLITE_ROW_QUALIFICATION_COHORTS.filter(value => cohort !== 'all' && value !== cohort) };
};
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
