#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { collectV8CoverageEntries } from '../../../tools/testing/coverage/index.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const tempDir = path.join(root, '.testCache', 'coverage-malformed-json-skip');
await fsPromises.rm(tempDir, { recursive: true, force: true });
await fsPromises.mkdir(tempDir, { recursive: true });

await fsPromises.writeFile(path.join(tempDir, 'bad.json'), '{not-json}\n', 'utf8');
await fsPromises.writeFile(path.join(tempDir, 'good.json'), JSON.stringify({
  result: [
    {
      url: path.join(root, 'src', 'shared', 'files.js'),
      functions: [
        {
          ranges: [
            { startOffset: 0, endOffset: 10, count: 1 }
          ]
        }
      ]
    }
  ]
}), 'utf8');

const entries = await collectV8CoverageEntries({ root, coverageDir: tempDir });
if (!Array.isArray(entries) || entries.length !== 1) {
  console.error('coverage malformed skip test failed: expected one valid coverage entry');
  process.exit(1);
}

console.log('coverage malformed json skip test passed');
