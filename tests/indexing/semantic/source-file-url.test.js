import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveSourceFileUrl } from '../../../src/index/semantic/source-file-url.js';

const repoRoot = path.resolve('source-url-fixture'), containerPath = 'nested/input.ts';
for (const [literal, expected] of [
  ['./%63hild.ts', 'child.ts'], ['./%2563hild.ts', '%63hild.ts'], ['./space%20name.ts', 'space name.ts'],
  ['./caf%C3%A9.ts', 'café.ts'], ['./percent%25.ts', 'percent%.ts'], ['./folder/%2e%2e/child.ts', 'child.ts'], ['./child.ts', 'child.ts']
]) {
  assert.deepEqual(resolveSourceFileUrl({ repoRoot, containerPath, literal }),
    { state: 'resolved', path: path.join(repoRoot, 'nested', expected) });
}
for (const [literal, reason] of [['./child%2fts', 'encoded_separator'], ['./child%5cts', 'encoded_separator'],
  ['./bad%.ts', 'malformed_encoding'], ['./%ff.ts', 'malformed_encoding'], ['./%00.ts', 'invalid_file_path'],
  ['../../outside.ts', 'outside_inventory'], ['./child.ts?query', 'relative_url_required'], ['./child.ts#hash', 'relative_url_required']]) {
  assert.deepEqual(resolveSourceFileUrl({ repoRoot, containerPath, literal }), { state: 'unresolved', reason });
}
assert.deepEqual(resolveSourceFileUrl({ repoRoot, containerPath: null, literal: './child.ts' }),
  { state: 'unresolved', reason: 'physical_origin_unavailable' });
assert.deepEqual(resolveSourceFileUrl({ repoRoot, containerPath: '../outside.ts', literal: './child.ts' }),
  { state: 'unresolved', reason: 'physical_origin_outside_inventory' });
if (process.platform === 'win32') {
  for (const windowsRoot of ['C:\\source url fixture', '\\\\server\\share\\source-url-fixture']) {
    assert.deepEqual(resolveSourceFileUrl({ repoRoot: windowsRoot, containerPath: 'src/main.ts', literal: './space%20name.ts' }),
      { state: 'resolved', path: path.join(windowsRoot, 'src', 'space name.ts') }, 'host-qualified drive/UNC URL conversion performs no I/O');
  }
}
console.log('Source file URLs decode exact pathname identity inside their admitted physical inventory.');
