import path from 'node:path';

export const buildBenchmarkActions = ({ root, runNode }) => [
  {
    label: 'bench-language-repos-test',
    run: () => runNode('bench-language-repos-test', path.join(root, 'tests', 'bench-language-repos.js')),
    covers: ['bench-language-repos-test']
  },
  {
    label: 'bench-language-lock-test',
    run: () => runNode('bench-language-lock-test', path.join(root, 'tests', 'bench-language-lock.js')),
    covers: ['bench-language-lock-test']
  },
  {
    label: 'bench-language-progress-parse-test',
    run: () => runNode('bench-language-progress-parse-test', path.join(root, 'tests', 'bench-language-progress-parse.js')),
    covers: ['bench-language-progress-parse-test']
  },
  {
    label: 'bench-language-lock-semantics-test',
    run: () => runNode('bench-language-lock-semantics-test', path.join(root, 'tests', 'bench-language-lock-semantics.js')),
    covers: ['bench-language-lock-semantics-test']
  },
  {
    label: 'bench-progress-format-test',
    run: () => runNode('bench-progress-format-test', path.join(root, 'tests', 'bench-progress-format.js')),
    covers: ['bench-progress-format-test']
  }
];
