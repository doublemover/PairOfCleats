import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfigContractDoc } from '../../../tools/config/contract-doc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const targetPath = path.join(root, 'docs', 'config', 'contract.md');

const raw = await fs.readFile(targetPath, 'utf8');
const hasBom = raw.startsWith('\uFEFF');
const lineEnding = raw.includes('\r\n') ? '\r\n' : '\n';
const expected = buildConfigContractDoc({ root, lineEnding, includeBom: hasBom });

assert.strictEqual(raw, expected);
console.log('config contract doc matches schema + env');
