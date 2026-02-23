#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveRulePathSafe } from '../../../tools/analysis/structural-search-paths.js';

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-structural-rule-paths-'));
const registryRepoRoot = path.join(tempRoot, 'registry-repo');
const registryDir = path.join(registryRepoRoot, 'rules');
const localRule = path.join(registryDir, 'local.yml');
const repoRule = path.join(registryRepoRoot, 'rules', 'pack', 'rule.yml');
const outsideRule = path.join(tempRoot, 'outside.yml');

try {
  await fsPromises.mkdir(path.dirname(localRule), { recursive: true });
  await fsPromises.mkdir(path.dirname(repoRule), { recursive: true });
  await fsPromises.writeFile(localRule, 'id: local\n');
  await fsPromises.writeFile(repoRule, 'id: repo\n');
  await fsPromises.writeFile(outsideRule, 'id: outside\n');

  assert.equal(
    resolveRulePathSafe({ rulePath: 'local.yml', registryRepoRoot, registryDir }),
    localRule,
    'expected local rule paths to resolve under registry dir'
  );
  assert.equal(
    resolveRulePathSafe({ rulePath: 'rules/pack/rule.yml', registryRepoRoot, registryDir }),
    repoRule,
    'expected rules/ paths to resolve under registry repo root'
  );
  assert.equal(
    resolveRulePathSafe({ rulePath: 'rules/../../outside.yml', registryRepoRoot, registryDir }),
    null,
    'expected rules/ traversal escape to be rejected'
  );
  assert.equal(
    resolveRulePathSafe({ rulePath: outsideRule, registryRepoRoot, registryDir }),
    outsideRule,
    'expected absolute paths to remain supported'
  );
} finally {
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('structural rule path safety test passed');
