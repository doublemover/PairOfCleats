#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { getVectorExtensionConfig } from '../../../tools/sqlite/vector-extension.js';
import { getExtensionsDir } from '../../../tools/shared/dict-utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'vector-extension-sanitize');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const config = getVectorExtensionConfig(tempRoot, null, {
  enabled: true,
  table: 'dense_vectors_ann; DROP TABLE chunks; --'
});
if (config.enabled) {
  console.error('Expected vector extension to be disabled for invalid table name.');
  process.exit(1);
}
if (!config.disabledReason) {
  console.error('Expected vector extension disabled reason to be set.');
  process.exit(1);
}

const traversal = getVectorExtensionConfig(tempRoot, null, {
  dir: path.join('..', 'outside-extensions'),
  path: path.join('..', 'outside-extensions', 'vec0.dll')
});
if (traversal.path !== null) {
  console.error('Expected unsafe vectorExtension.path override to be ignored.');
  process.exit(1);
}
if (traversal.dir !== getExtensionsDir(tempRoot, {})) {
  console.error('Expected unsafe vectorExtension.dir override to fall back to default extensions dir.');
  process.exit(1);
}

const absolutePath = path.resolve(tempRoot, 'extensions', 'vec0.dll');
const absoluteOverride = getVectorExtensionConfig(tempRoot, null, {
  path: absolutePath
});
if (absoluteOverride.path !== absolutePath) {
  console.error('Expected absolute vectorExtension.path override to remain supported.');
  process.exit(1);
}

console.log('vector extension sanitize test passed');

