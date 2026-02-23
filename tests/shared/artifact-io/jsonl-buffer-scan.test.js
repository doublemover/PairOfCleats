#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonLinesArray, readJsonLinesEach } from '../../../src/shared/artifact-io.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'jsonl-buffer-scan');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const filePath = path.join(cacheRoot, 'large.jsonl');
const longText = 'x'.repeat(200000);
const payload = `{\"id\":1,\"text\":\"${longText}\"}\n{\"id\":2,\"text\":\"short\"}\r\n`;
await fs.writeFile(filePath, payload);

const rows = await readJsonLinesArray(filePath, { maxBytes: 5 * 1024 * 1024 });
assert.equal(rows.length, 2);
assert.equal(rows[0].id, 1);
assert.equal(rows[1].id, 2);

const eachRows = [];
await readJsonLinesEach(filePath, (row) => eachRows.push(row), { maxBytes: 5 * 1024 * 1024 });
assert.deepEqual(eachRows.map((row) => row.id), [1, 2]);
