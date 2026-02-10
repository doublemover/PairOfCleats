import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import { readJsonLinesArray } from '../../../src/shared/artifact-io/json.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'validation-fastpath');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const jsonlPath = path.join(tempRoot, 'rows.jsonl');
await writeJsonLinesFile(jsonlPath, [
  { id: 1, value: 'ok' },
  { value: 'missing-id' }
], { atomic: true });

const trusted = await readJsonLinesArray(jsonlPath, {
  validationMode: 'trusted',
  requiredKeys: ['id']
});
assert.strictEqual(trusted.length, 2, 'trusted mode should skip required key validation');

let threw = false;
try {
  await readJsonLinesArray(jsonlPath, {
    validationMode: 'strict',
    requiredKeys: ['id']
  });
} catch {
  threw = true;
}
assert.ok(threw, 'strict mode should reject missing keys');

console.log('validation fast-path test passed');
