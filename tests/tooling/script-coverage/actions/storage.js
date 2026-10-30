import path from 'node:path';

export const buildStorageActions = ({ root, runNode }) => [
  {
    label: 'compact-sqlite-index-help',
    run: () => runNode(
      'compact-sqlite-index-help',
      path.join(root, 'tools', 'build', 'compact-sqlite-index.js'),
      ['--help']
    ),
    covers: ['compact-sqlite-index'],
    coversTierB: ['compact-sqlite-index']
  }
];
