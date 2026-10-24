import assert from 'node:assert/strict';
import { enumerateWorkspace } from '../../../src/retrieval/federation/enumeration.js';
const requests = [];
const common = { tasks: [{ repo: { repoId: 'authored', repoRootCanonical: process.cwd() }, mode: 'code' }],
  args: ['--file', 'name.js', '--', '--cursor', 'literal-tail'], manifestHash: 'fixed-generation',
  verifyGeneration: async () => {}, search: async (_root, request) => {
    requests.push(request.args);
    return { code: [{ chunkUid: `chunk-${requests.length}` }], pagination: { nextCursor: requests.length === 1 ? 'local-page-2' : null } };
  } };
const first = await enumerateWorkspace(common);
const second = await enumerateWorkspace({ ...common, cursor: first.pagination.nextCursor });
for (const args of requests) {
  const end = args.indexOf('--');
  assert.deepEqual(args.slice(end), ['--', '--cursor', 'literal-tail']);
  assert.ok(args.indexOf('--mode') < end);
}
assert.deepEqual(requests[1].slice(0, requests[1].indexOf('--')).slice(-2), ['--cursor', 'local-page-2']);
assert.notEqual(first.code[0].chunkUid, second.code[0].chunkUid);
assert.equal(second.pagination.hasMore, false);
console.log('federated enumeration option terminator passed');
