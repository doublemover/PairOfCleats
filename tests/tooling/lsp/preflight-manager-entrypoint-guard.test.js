#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const toolingRoot = path.join(root, 'src', 'index', 'tooling');
const expectedPath = path.join('src', 'index', 'tooling', 'preflight-manager.js').replace(/\\/g, '/');

const walkJsFiles = (dir) => {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJsFiles(abs));
      continue;
    }
    if (entry.isFile() && abs.endsWith('.js')) out.push(abs);
  }
  return out;
};

const matches = [];
for (const abs of walkJsFiles(toolingRoot)) {
  const content = fs.readFileSync(abs, 'utf8');
  if (content.includes('await provider.preflight(')) {
    matches.push(path.relative(root, abs).replace(/\\/g, '/'));
  }
}

assert.equal(matches.length > 0, true, 'expected at least one provider.preflight await call for guard to be meaningful');
assert.deepEqual(
  matches,
  [expectedPath],
  'expected provider.preflight(...) invocation to be owned only by preflight-manager'
);

console.log('preflight manager entrypoint guard test passed');
