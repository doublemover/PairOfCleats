#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'config-search-hyperlinks');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

await fs.writeFile(
  path.join(tempRoot, '.pairofcleats.json'),
  JSON.stringify({
    search: {
      hyperlinks: 'vscode'
    }
  }, null, 2)
);

const userConfig = loadUserConfig(tempRoot);
if (userConfig?.search?.hyperlinks !== 'vscode') {
  console.error(`expected search.hyperlinks to normalize to vscode, got ${userConfig?.search?.hyperlinks}`);
  process.exit(1);
}

console.log('search hyperlinks config normalization test passed');
