import path from 'node:path';

export const buildCoreActions = ({ root, runNode }) => [
  {
    label: 'download-dicts-test',
    run: () => runNode('download-dicts-test', path.join(root, 'tests', 'tooling', 'install', 'download-dicts.test.js')),
    covers: ['download-dicts', 'download-dicts-test']
  },
  {
    label: 'download-extensions-test',
    run: () => runNode('download-extensions-test', path.join(root, 'tests', 'tooling', 'install', 'download-extensions.test.js')),
    covers: ['download-extensions', 'verify-extensions', 'download-extensions-test']
  },
  {
    label: 'vector-extension-sanitize-test',
    run: () => runNode('vector-extension-sanitize-test', path.join(root, 'tests', 'storage', 'vector-extension', 'sanitize.test.js')),
    covers: ['vector-extension-sanitize-test']
  },
  {
    label: 'vector-extension-missing-test',
    run: () => runNode('vector-extension-missing-test', path.join(root, 'tests', 'storage', 'vector-extension', 'missing.test.js')),
    covers: ['vector-extension-missing-test']
  },
  {
    label: 'xxhash-backends-test',
    run: () => runNode('xxhash-backends-test', path.join(root, 'tests', 'shared', 'hash', 'xxhash-backends.test.js')),
    covers: ['xxhash-backends-test']
  },
  {
    label: 'safe-regex-engine-test',
    run: () => runNode('safe-regex-engine-test', path.join(root, 'tests', 'shared', 'safe-regex', 'engine.test.js')),
    covers: ['safe-regex-engine-test']
  },
  {
    label: 'tooling-detect-test',
    run: () => runNode('tooling-detect-test', path.join(root, 'tests', 'tooling', 'install', 'tooling-detect.test.js')),
    covers: ['tooling-detect', 'tooling-detect-test']
  },
  {
    label: 'tooling-install-test',
    run: () => runNode('tooling-install-test', path.join(root, 'tests', 'tooling', 'install', 'tooling.test.js')),
    covers: ['tooling-install', 'tooling-install-test']
  },
  {
    label: 'capabilities-report-test',
    run: () => runNode('capabilities-report-test', path.join(root, 'tests', 'tooling', 'reports', 'capabilities-report.test.js')),
    covers: ['capabilities-report-test']
  },
  {
    label: 'clean-artifacts-test',
    run: () => runNode('clean-artifacts-test', path.join(root, 'tests', 'indexing', 'artifacts', 'clean.test.js')),
    covers: ['clean-artifacts', 'clean-artifacts-test']
  },
  {
    label: 'uninstall-test',
    run: () => runNode('uninstall-test', path.join(root, 'tests', 'tooling', 'install', 'uninstall.test.js')),
    covers: ['uninstall', 'uninstall-test']
  }
];
