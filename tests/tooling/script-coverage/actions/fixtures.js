import path from 'node:path';

export const buildFixtureActions = ({ root, runNode }) => [
  {
    label: 'verify',
    run: () => runNode('verify', path.join(root, 'tests', 'smoke', 'smoke.test.js')),
    covers: ['verify']
  },
  {
    label: 'fixture-smoke',
    run: () => runNode('fixture-smoke', path.join(root, 'tests', 'indexing', 'fixtures', 'build-and-artifacts.test.js')),
    covers: ['fixture-smoke', 'build-index', 'build-sqlite-index', 'search'],
    coversTierB: ['build-index', 'build-sqlite-index']
  },
  {
    label: 'fixture-parity',
    run: () => runNode('fixture-parity', path.join(root, 'tests', 'tooling', 'fixtures', 'fixture-parity.test.js'), ['--fixtures', 'sample']),
    covers: ['fixture-parity']
  },
  {
    label: 'fixture-empty',
    run: () => runNode('fixture-empty', path.join(root, 'tests', 'tooling', 'fixtures', 'fixture-empty.test.js')),
    covers: []
  },
  {
    label: 'fixture-eval',
    run: () => runNode('fixture-eval', path.join(root, 'tests', 'tooling', 'fixtures', 'fixture-eval.test.js')),
    covers: []
  },
  {
    label: 'eval-quality-test',
    run: () => runNode('eval-quality-test', path.join(root, 'tests', 'tooling', 'eval', 'eval-quality.test.js')),
    covers: ['eval-quality-test']
  }
];
