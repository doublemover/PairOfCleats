import assert from 'node:assert/strict';
import { computeDocHash } from '../../../src/index/tooling/vfs/doc-hash.js';
import { buildVfsToken, buildVfsTokenUri, parseVfsTokenUri, registerVfsTokenMapping,
  resolveVfsVirtualPathFromToken } from '../../../src/integrations/tooling/lsp/uris.js';

const paths = ['.poc-vfs/fixture-token-origin/left.ts', '.poc-vfs/fixture-token-origin/right.ts'];
const docHash = await computeDocHash('export const sameContent = true;\n');
const shared = await Promise.all(paths.map(virtualPath => buildVfsToken({ virtualPath, docHash, mode: 'docHash' })));
assert.equal(shared[0], shared[1], 'content-only tokens remain content hashes');
registerVfsTokenMapping(shared[0], paths[0]);
assert.equal(resolveVfsVirtualPathFromToken(shared[0]), paths[0]);
registerVfsTokenMapping(shared[0], paths[1]);
assert.equal(resolveVfsVirtualPathFromToken(shared[0]), null, 'an ambiguous content token cannot select the last origin');
registerVfsTokenMapping(shared[0], paths[0]);
assert.equal(resolveVfsVirtualPathFromToken(shared[0]), null, 'registering one origin again cannot erase known ambiguity');
for (const virtualPath of paths) {
  assert.equal(parseVfsTokenUri(buildVfsTokenUri({ virtualPath, token: shared[0] })).virtualPath, virtualPath);
  const token = await buildVfsToken({ virtualPath, docHash, mode: 'docHash+virtualPath' });
  registerVfsTokenMapping(token, virtualPath);
  assert.equal(resolveVfsVirtualPathFromToken(token), virtualPath, 'origin-scoped tokens retain normal lookup');
}
assert.equal(parseVfsTokenUri(`poc-vfs:///?token=${shared[0]}`).virtualPath, null);
console.log('Content-only token ambiguity fails closed while explicit URI paths and origin-scoped tokens retain authority.');
