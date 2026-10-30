import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const loaded = new Set();
const hook = registerHooks({ load(url, context, nextLoad) {
  loaded.add(url);
  return nextLoad(url, context);
} });
try {
  const { createTuiIndexWorkflows } = await import('../../tools/tui/operator/index-workflows.js');
  const session = createTuiIndexWorkflows({ scopes: {} });
  try {
    const catalog = session.describe({});
    assert.ok(catalog.commands.some(command => command.id === 'index.snapshot.create'));
    assert.ok(catalog.commands.some(command => command.id === 'service.indexer'));
    assert.deepEqual([...loaded].filter(url =>
      url.endsWith('/src/integrations/core/build-index/index.js')
      || url.endsWith('/tools/service/indexer-service/job-executor.js')), [],
    'catalog discovery must not initialize unrelated indexing execution owners');
  } finally { await session.dispose(); }
} finally { hook.deregister(); }
console.log('workflow module loading test passed');
