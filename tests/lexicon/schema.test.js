#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { normalizeWordlistPayload } from '../../src/lang/lexicon/normalize.js';

const root = process.cwd();
const schemaPath = path.join(root, 'src', 'lang', 'lexicon', 'language-lexicon-wordlist.schema.json');
const wordlistsDir = path.join(root, 'src', 'lang', 'lexicon', 'wordlists');

const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const entries = await fs.readdir(wordlistsDir, { withFileTypes: true });
const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name).sort();
assert.ok(files.length > 0, 'expected lexicon wordlists');

for (const fileName of files) {
  const filePath = path.join(wordlistsDir, fileName);
  const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const ok = validate(payload);
  assert.equal(ok, true, `schema invalid for ${fileName}: ${(validate.errors || []).map((e) => e.message).join('; ')}`);
  assert.ok(Array.isArray(payload.keywords), `${fileName} missing keywords[]`);
  assert.ok(Array.isArray(payload.literals), `${fileName} missing literals[]`);
  for (const key of ['keywords', 'literals', 'types', 'builtins', 'modules']) {
    const list = Array.isArray(payload[key]) ? payload[key] : [];
    const unique = new Set(list);
    assert.equal(unique.size, list.length, `${fileName} ${key} must be unique`);
    for (const token of list) {
      assert.equal(token, token.toLowerCase(), `${fileName} ${key} token must be lowercase: ${token}`);
    }
  }
  const normalized = normalizeWordlistPayload(payload, { filePath, strict: true });
  assert.ok(normalized.keywords instanceof Set, `${fileName} normalized keywords set missing`);
  assert.ok(normalized.literals instanceof Set, `${fileName} normalized literals set missing`);
}

console.log('lexicon schema test passed');
