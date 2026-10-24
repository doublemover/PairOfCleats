import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { handleToolCall } from '../../../tools/mcp/tools.js';
import { getToolDefs } from '../../../src/integrations/mcp/defs.js';
import { createSemanticDetailFixture } from '../../helpers/api-semantic-detail-fixture.js';

const fixture = await createSemanticDetailFixture();
try {
  const { request, first, post, file } = fixture;
  assert.ok(getToolDefs().some((tool) => tool.name === 'semantic_detail' && tool.inputSchema.properties.include));
  const mcp = await handleToolCall('semantic_detail', request);
  assert.deepEqual({ ...mcp, cursor: null }, { ...first, cursor: null });
  const mcpNext = await handleToolCall('semantic_detail', { ...request, cursor: mcp.cursor });
  assert.equal(mcpNext.records.length, 0, 'lossless member continuation does not duplicate the requested node');
  const response = await post(request);
  assert.equal(response.status, 200);
  assert.deepEqual({ ...response.body.result, cursor: null }, { ...first, cursor: null });
  const stale = await post({ ...request, generation: { ...request.generation, baseBuildId: 'nonexistent' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.semanticCode, 'ERR_SEMANTIC_GENERATION_MISMATCH');
  assert.equal((await post({ ...request, include: ['trace'] })).status, 400);
  assert.equal((await post({ ...request, cursor: 'expired' })).status, 410);
  const { stdout } = await promisify(execFile)(process.execPath, ['bin/pairofcleats.js', 'semantic', 'detail', '--request', file, '--all'], { cwd: process.cwd(), timeout: 10000, maxBuffer: 1048576 });
  const pages = stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(pages.length > 2);
  assert.equal(pages.at(-1).cursor, null);
  assert.equal(pages.flatMap((page) => page.operands).filter((row) => row.slot === 'argument').length, 6);

  await fixture.publishNewGeneration();
  const continuation = await post({ ...request, cursor: response.body.result.cursor });
  assert.equal(continuation.status, 200);
  assert.deepEqual(continuation.body.result.generation, request.generation);
  console.log('Semantic detail CLI/MCP/HTTP and retained generation surfaces passed');
} finally {
  await fixture.close();
}
