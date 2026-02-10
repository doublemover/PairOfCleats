export const SWEET16_CI_SUITE = [
  {
    id: 'artifact-io-throughput',
    script: 'tools/bench/artifact-io/artifact-io-throughput.js',
    args: ['--mode', 'compare', '--rows', '50000', '--maxBytes', '4096'],
    expect: { baseline: true, current: true, delta: true }
  },
  {
    id: 'artifact-io-streaming-vs-materialize',
    script: 'tools/bench/artifact-io/streaming-vs-materialize.js',
    args: ['--rows', '50000', '--maxBytes', '4096'],
    expect: { baseline: true, current: true, delta: true }
  },
  {
    id: 'cache-hit-rate',
    script: 'tools/bench/cache-hit-rate.js',
    args: ['--mode', 'compare', '--ops', '200000', '--keys', '20000', '--iterations', '1', '--writer', 'true'],
    expect: { baseline: true, current: true, delta: true }
  },
  {
    id: 'postings-real',
    script: 'tools/bench/index/postings-real.js',
    args: ['--mode', 'compare', '--count', '250', '--seed', 'bench-runner', '--threads-baseline', '1', '--threads-current', '2'],
    expect: { baseline: true, current: true, delta: true }
  },
  {
    id: 'chargram-postings',
    script: 'tools/bench/index/chargram-postings.js',
    args: ['--mode', 'compare', '--vocab', '10000', '--docs', '5000', '--postings', '3', '--spill', '25000', '--rolling-hash'],
    expect: { baseline: true, current: true, delta: true }
  },
  {
    id: 'relations-build',
    script: 'tools/bench/index/relations-build.js',
    args: ['--mode', 'compare', '--chunks', '5000', '--edges', '2', '--maxBytes', '131072'],
    expect: { baseline: true, current: true, delta: true }
  },
  {
    id: 'filter-index-build',
    script: 'tools/bench/index/filter-index-build.js',
    args: ['--mode', 'compare', '--files', '1000', '--chunksPerFile', '16', '--minSize', '128'],
    expect: { baseline: true, current: true, delta: true },
    allowSkip: true
  },
  {
    id: 'repo-map-compress',
    script: 'tools/bench/index/repo-map-compress.js',
    args: ['--mode', 'compare', '--rows', '50000', '--maxBytes', '4096'],
    expect: { baseline: true, current: true, delta: true }
  },
  {
    id: 'index-state-write',
    script: 'tools/bench/index/index-state-write.js',
    args: ['--mode', 'compare', '--updates', '20', '--files', '2000'],
    expect: { baseline: true, current: true, delta: true }
  },
  {
    id: 'file-meta-compare',
    script: 'tools/bench/index/file-meta-compare.js',
    args: ['--mode', 'compare', '--files', '25000'],
    expect: { baseline: true, current: true, delta: true }
  },
  {
    id: 'minhash-packed',
    script: 'tools/bench/index/minhash-packed.js',
    args: ['--mode', 'compare', '--count', '5000', '--dims', '64'],
    expect: { baseline: true, current: true, delta: true }
  },
  {
    id: 'sqlite-build-from-artifacts',
    script: 'tools/bench/sqlite/build-from-artifacts.js',
    args: ['--mode', 'compare', '--chunks', '20000', '--statement-strategy', 'prepared'],
    expect: { baseline: true, current: true, delta: true }
  },
  {
    id: 'vfs-parallel-manifest-build',
    script: 'tools/bench/vfs/parallel-manifest-build.js',
    args: ['--segments', '500', '--segment-bytes', '64', '--concurrency', '1,2,4', '--samples', '1', '--json'],
    expect: { json: true }
  },
  {
    id: 'tree-sitter-load',
    script: 'tools/bench/index/tree-sitter-load.js',
    args: ['--languages', 'javascript,go,rust', '--files-per-language', '10', '--repeats', '1', '--json'],
    expect: { json: true }
  }
];

export const SWEET16_SUITE = SWEET16_CI_SUITE;

export const resolveBenchSuite = (suiteName) => {
  const normalized = String(suiteName || '').trim().toLowerCase();
  if (!normalized || normalized === 'sweet16') return SWEET16_SUITE;
  if (normalized === 'sweet16-ci' || normalized === 'sweet16_ci') return SWEET16_CI_SUITE;
  return null;
};
