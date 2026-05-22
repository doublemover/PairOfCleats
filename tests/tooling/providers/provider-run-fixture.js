import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

export const createToolingProviderFixtureInput = () => ({
  documents: [{
    virtualPath: 'src/sample.fixture',
    languageId: 'fixture',
    docHash: 'hash-1'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'chunk-1',
      chunkId: 'chunk-1',
      file: 'src/sample.fixture',
      range: { start: 0, end: 1 }
    },
    name: 'sample',
    virtualPath: 'src/sample.fixture',
    virtualRange: { start: 0, end: 1 }
  }]
});

export const createToolingProviderLogCollector = () => {
  const logs = [];
  return {
    logs,
    logger: (line) => logs.push(String(line || ''))
  };
};

export const runToolingProviderFixture = async (options = {}) => runToolingProviders({
  strict: true,
  toolingConfig: {},
  cache: { enabled: false },
  logger: options.logger,
  ...(options.orchestratorOptions || {})
}, options.input || createToolingProviderFixtureInput());
