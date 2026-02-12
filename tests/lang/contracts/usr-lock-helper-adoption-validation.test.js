#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const contractsDir = __dirname;

const thisFileName = path.basename(__filename);

const testFiles = fs.readdirSync(contractsDir)
  .filter((name) => name.startsWith('usr-') && name.endsWith('.test.js'))
  .filter((name) => name !== thisFileName);

const bannedHelperDefinitions = [
  {
    token: 'const extractSection =',
    message: 'local extractSection helper must not be redefined; use usr-lock-test-utils.js'
  },
  {
    token: 'const extractHeadingSection =',
    message: 'local extractHeadingSection helper must not be redefined; use usr-lock-test-utils.js'
  },
  {
    token: 'const checklistLineState =',
    message: 'local checklistLineState helper must not be redefined; use usr-lock-test-utils.js'
  },
  {
    token: 'const hasUnchecked =',
    message: 'local hasUnchecked helper must not be redefined; use usr-lock-test-utils.js'
  },
  {
    token: 'const assertTestsPresent =',
    message: 'local assertTestsPresent helper must not be redefined; use usr-lock-test-utils.js'
  }
];

for (const fileName of testFiles) {
  const filePath = path.join(contractsDir, fileName);
  const text = fs.readFileSync(filePath, 'utf8');

  for (const { token, message } of bannedHelperDefinitions) {
    assert.equal(
      text.includes(token),
      false,
      `${fileName}: ${message}`
    );
  }
}

console.log('usr lock helper adoption validation checks passed');
