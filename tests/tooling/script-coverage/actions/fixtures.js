import path from 'node:path';

export const buildFixtureActions = ({ root, runNode }) => [
  {
    label: 'fixture-parity',
    run: () => runNode('fixture-parity', path.join(root, 'tests', 'tooling', 'fixtures', 'fixture-parity.test.js'), ['--fixtures', 'sample']),
    covers: ['fixture-parity']
  }
];
