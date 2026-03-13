#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'tools', 'tooling', 'install.js'), 'utf8');

assert.match(
  source,
  /import\s+\{\s*[^}]*exitLikeCommandResult[^}]*\}\s+from\s+'..\/shared\/cli-utils\.js';/,
  'expected tooling-install to import exitLikeCommandResult'
);
assert.match(
  source,
  /if\s*\(typeof\s+result\.signal\s*===\s*'string'\s*&&\s*result\.signal\.trim\(\)\)\s*\{\s*exitLikeCommandResult\(\{\s*status:\s*null,\s*signal:\s*result\.signal\s*\}\);/s,
  'expected tooling-install to exit like the interrupted child command when an install action is terminated by signal'
);

console.log('tooling-install signal exit contract test passed');
