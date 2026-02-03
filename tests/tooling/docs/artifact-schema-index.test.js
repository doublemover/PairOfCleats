import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArtifactSchemaIndex } from '../../../src/shared/artifact-schema-index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const targetPath = path.join(root, 'docs', 'contracts', 'artifact-schema-index.json');

const expected = buildArtifactSchemaIndex();
const raw = await fs.readFile(targetPath, 'utf8');
const actual = JSON.parse(raw);

assert.deepStrictEqual(actual, expected);
console.log('artifact schema index matches registry');
