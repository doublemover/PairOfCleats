import path from 'node:path';

export const buildIndexingActions = ({ root, runNode }) => [
  ...['identical-config', 'tokenization-config', 'dictionary-config'].map(caseId => ({
    label: `incremental-tokenization-cache-${caseId}`,
    run: () => runNode(`incremental-tokenization-cache-${caseId}`,
      path.join(root, 'tests', 'indexing', 'incremental', 'tokenization-cache.test.js'), ['--case', caseId]),
    covers: ['incremental-tokenization-cache-test']
  }))
];
