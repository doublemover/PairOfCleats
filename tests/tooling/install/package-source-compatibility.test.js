#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getToolingRegistry } from '../../../tools/tooling/utils.js';

const root = process.cwd();
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const registry = getToolingRegistry(path.join(root, '.testCache', 'tooling-plan-only'), root);
const typescript = registry.find((tool) => tool.id === 'tsserver');
assert.ok(typescript);
for (const scope of ['cache', 'user']) {
  const plan = typescript.install[scope];
  assert.equal(plan.cmd, 'npm');
  assert.equal(plan.args.at(-1), `typescript@${metadata.dependencies.typescript}`,
    `${scope}: retain the compiler/tsserver API dependency contract`);
  assert.equal(plan.args.includes('typescript'), false, 'never install an unbounded latest compiler');
}
assert.ok(typescript.install.cache.args.includes('--prefix'));
assert.ok(typescript.install.user.args.includes('-g'));

const sqls = registry.find((tool) => tool.id === 'sqls');
assert.ok(sqls);
assert.equal(sqls.docs, 'https://github.com/sqls-server/sqls');
for (const scope of ['cache', 'user']) {
  assert.deepEqual(sqls.install[scope].args, ['install', 'github.com/sqls-server/sqls@latest']);
  assert.equal(sqls.install[scope].requires, 'go');
}
assert.ok(path.isAbsolute(sqls.install.cache.env.GOBIN));
console.log('tooling package source compatibility test passed; no install executed');
