#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { getVectorExtensionConfig } from '../tools/vector-extension.js';
import { loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'vector-extension-sanitize');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const configPath = path.join(tempRoot, '.pairofcleats.json');
await fs.writeFile(configPath, JSON.stringify({
  sqlite: {
    vectorExtension: {
      enabled: true,
      table: 'dense_vectors_ann; DROP TABLE chunks; --'
    }
  }
}, null, 2));

const userConfig = loadUserConfig(tempRoot);
const config = getVectorExtensionConfig(tempRoot, userConfig);
if (config.enabled) {
  console.error('Expected vector extension to be disabled for invalid table name.');
  process.exit(1);
}
if (!config.disabledReason) {
  console.error('Expected vector extension disabled reason to be set.');
  process.exit(1);
}

console.log('vector extension sanitize test passed');
