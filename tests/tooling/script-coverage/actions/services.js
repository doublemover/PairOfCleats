import path from 'node:path';

export const buildServiceActions = ({ root, runNode }) => [
  {
    label: 'mcp-server-test',
    run: () => runNode('mcp-server-test', path.join(root, 'tests', 'services', 'mcp', 'tools-list.test.js')),
    covers: ['mcp-server-test', 'mcp-server']
  },
  {
    label: 'mcp-schema-test',
    run: () => runNode('mcp-schema-test', path.join(root, 'tests', 'services', 'mcp', 'schema.test.js')),
    covers: ['mcp-schema-test']
  },
  {
    label: 'mcp-robustness-test',
    run: () => runNode('mcp-robustness-test', path.join(root, 'tests', 'services', 'mcp', 'robustness.test.js')),
    covers: ['mcp-robustness-test']
  },
  {
    label: 'api-server-test',
    run: () => runNode('api-server-test', path.join(root, 'tests', 'services', 'api', 'health-and-status.test.js')),
    covers: ['api-server-test']
  },
  {
    label: 'api-server-stream-test',
    run: () => runNode('api-server-stream-test', path.join(root, 'tests', 'services', 'api', 'server-stream.test.js')),
    covers: ['api-server-stream-test']
  },
  {
    label: 'indexer-service-test',
    run: () => runNode('indexer-service-test', path.join(root, 'tests', 'services', 'indexer', 'service.test.js')),
    covers: ['indexer-service-test']
  },
  {
    label: 'service-queue-test',
    run: () => runNode('service-queue-test', path.join(root, 'tests', 'services', 'queue', 'service.test.js')),
    covers: ['service-queue-test']
  }
];
