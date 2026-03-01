const TIER_B_DEFAULT = [
  'build-index',
  'build-lmdb-index',
  'compact-sqlite-index'
];

const createCoverageEntry = () => ({ status: 'pending', via: null, reason: null });

export const createCoverageState = ({ scriptNames, enforceTierB = true }) => {
  const coverage = new Map(scriptNames.map((name) => [name, createCoverageEntry()]));
  const tierBRequired = enforceTierB
    ? new Set(TIER_B_DEFAULT.filter((name) => coverage.has(name)))
    : new Set();
  const tierBCoverage = new Map(
    Array.from(tierBRequired, (name) => [name, createCoverageEntry()])
  );
  const unknownCovers = new Set();

  const markCovered = (name, via) => {
    if (!coverage.has(name)) {
      unknownCovers.add(name);
      return;
    }
    const entry = coverage.get(name);
    if (entry.status === 'pending') {
      coverage.set(name, { status: 'covered', via, reason: null });
    }
  };

  const markSkipped = (name, reason) => {
    if (!coverage.has(name)) return;
    coverage.set(name, { status: 'skipped', via: null, reason });
  };

  const markTierBCovered = (name, via) => {
    if (!enforceTierB) return;
    if (!tierBCoverage.has(name)) {
      unknownCovers.add(name);
      return;
    }
    const entry = tierBCoverage.get(name);
    if (entry.status === 'pending') {
      tierBCoverage.set(name, { status: 'covered', via, reason: null });
    }
  };

  return {
    coverage,
    tierBCoverage,
    tierBRequired,
    unknownCovers,
    markCovered,
    markSkipped,
    markTierBCovered
  };
};

export const applyActionCoverage = (state, action) => {
  const covers = Array.isArray(action.covers) ? action.covers : [];
  for (const name of covers) {
    state.markCovered(name, action.label);
  }
  const tierCovers = Array.isArray(action.coversTierB) ? action.coversTierB : [];
  for (const name of tierCovers) {
    state.markTierBCovered(name, action.label);
  }
};

export const applyDefaultSkips = (state) => {
  if (state.coverage.has('script-coverage-test')) {
    state.markCovered('script-coverage-test', 'self');
  }
  state.markSkipped('test-all', 'aggregates script-coverage-test and bench');
  state.markSkipped('test-all-no-bench', 'aggregates script-coverage-test without bench');
  state.markSkipped('download-models', 'requires network model download');
  state.markSkipped('bench', 'benchmarks are long-running');
  state.markSkipped('bench-ann', 'benchmarks are long-running');
  state.markSkipped('bench-dict-seg', 'benchmarks are long-running');
  state.markSkipped('bench-score-strategy', 'benchmarks are long-running');
  state.markSkipped('bench-micro', 'benchmarks are long-running');
  state.markSkipped('compare-models', 'benchmark/perf evaluation');
  state.markSkipped('bench-language', 'benchmarks are long-running');
  state.markSkipped('smoke:api-core-health', 'smoke lanes are run manually');
  state.markSkipped('smoke:retrieval', 'smoke lanes are run manually');
  state.markSkipped('smoke:services', 'smoke lanes are run manually');
  state.markSkipped('smoke:workers', 'smoke lanes are run manually');
  state.markSkipped('smoke:embeddings', 'smoke lanes are run manually');
  state.markSkipped('smoke:sqlite', 'smoke lanes are run manually');
  state.markSkipped('watch-index', 'watch mode runs until interrupted');
  state.markSkipped('api-server', 'service runs until interrupted');
  state.markSkipped('indexer-service', 'service runs until interrupted');
  state.markSkipped('bootstrap:ci', 'ci bootstrap wrapper command');
  state.markSkipped('patch', 'patch-package wrapper command');
  state.markSkipped('rebuild:native', 'native rebuild wrapper command');
  state.markSkipped('postinstall', 'npm lifecycle hook');
  state.markSkipped('format', 'modifies working tree');
  state.markSkipped('lint', 'requires npm install and project lint config');

  for (const name of state.coverage.keys()) {
    if (name.startsWith('bench-language:')) {
      state.markSkipped(name, 'bench-language variants are long-running');
    }
  }
};

export const finalizeCoverage = (state) => {
  const missing = [];
  const skipped = [];
  const covered = [];
  for (const [name, entry] of state.coverage.entries()) {
    if (entry.status === 'pending') missing.push(name);
    if (entry.status === 'skipped') skipped.push({ name, reason: entry.reason });
    if (entry.status === 'covered') covered.push({ name, via: entry.via });
  }

  const missingTierB = [];
  const coveredTierB = [];
  for (const [name, entry] of state.tierBCoverage.entries()) {
    if (entry.status === 'pending') missingTierB.push(name);
    if (entry.status === 'covered') coveredTierB.push({ name, via: entry.via });
  }

  return {
    missing,
    missingTierB,
    skipped,
    covered,
    coveredTierB,
    unknownCovers: Array.from(state.unknownCovers)
  };
};

export const reportCoverage = (summary) => {
  if (summary.unknownCovers.length) {
    console.error(`Unknown coverage script names: ${summary.unknownCovers.join(', ')}`);
    return false;
  }
  if (summary.missing.length || summary.missingTierB.length) {
    if (summary.missing.length) {
      console.error(`Missing coverage for: ${summary.missing.join(', ')}`);
    }
    if (summary.missingTierB.length) {
      console.error(`Missing Tier B coverage for: ${summary.missingTierB.join(', ')}`);
    }
    return false;
  }

  console.log(`script coverage: ${summary.covered.length} covered, ${summary.skipped.length} skipped`);
  console.log(`tier B coverage: ${summary.coveredTierB.length} covered, ${summary.missingTierB.length} missing`);
  if (summary.skipped.length) {
    for (const entry of summary.skipped) {
      console.log(`- skipped ${entry.name}: ${entry.reason}`);
    }
  }
  return true;
};
