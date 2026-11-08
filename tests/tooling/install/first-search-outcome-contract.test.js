#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createFirstSearchPlan, applyFirstSearchPlan } from '../../../tools/setup/first-search-plan.js';
import { admitFirstSearchToolReceipt, describeAppliedFirstSearchCapabilities } from '../../../tools/setup/first-search-capabilities.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-first-search-outcome-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off',
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_TRUSTED_REPOS: null } });
const repoRoot = path.join(root, 'selected project');
await fs.mkdir(repoRoot);
try {
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), '{}');
  const plan = await createFirstSearchPlan({ repoRoot });
  assert.equal(plan.state, 'planned', 'untrusted targets use the canonical disabled install-on-detect default');
  const receipt = { root: repoRoot, results: [{ id: 'selected-tool', status: 'already-installed', probe: { ok: true },
    receiptId: 'owned-fixture-receipt', receiptPath: path.join(root, 'receipt.json') }],
  readiness: { schemaVersion: 1, ready: true, items: [{ id: 'selected-tool', state: 'available-and-verified', verificationLevel: 'executable-probe-and-layout' }] } };
  const admitted = admitFirstSearchToolReceipt(JSON.stringify(receipt), { repoRoot, tools: ['selected-tool'] });
  const capability = describeAppliedFirstSearchCapabilities({ ...plan, capabilities: { readiness: [{ id: 'tool:selected-tool',
    state: 'not-probed', protocol: 'not-probed', project: 'not-probed' }] } }, { completed: ['tooling'], toolingReadiness: admitted })[0];
  assert.equal(capability.state, 'executable-runtime-verified');
  assert.equal(capability.protocol, 'not-probed');
  assert.equal(capability.project, 'not-probed');
  for (const text of ['null', '{}', '{', JSON.stringify({ ...receipt, results: [] }),
    JSON.stringify({ ...receipt, readiness: { ...receipt.readiness, ready: false } }),
    JSON.stringify({ ...receipt, results: [{ ...receipt.results[0], receiptId: null }] })]) {
    assert.throws(() => admitFirstSearchToolReceipt(text, { repoRoot, tools: ['selected-tool'] }), { code: 'ERR_SETUP_TOOL_RECEIPT' });
  }
  const cache = getRepoCacheRoot(repoRoot);
  const buildRoot = path.join(cache, 'builds', 'authored-index');
  const applied = await applyFirstSearchPlan(plan, { execute: async (_command, args) => {
    if (args[0].endsWith('build_index.js')) {
      const indexDir = await createCompatibilityIndex(buildRoot, { compatibilityKey: 'compat-code' });
      await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([{ id: 0, file: 'selected.js',
        name: 'firstUsefulSymbol', kind: 'FunctionDeclaration', start: 1, end: 2 }]));
      await fs.writeFile(path.join(cache, 'builds', 'current.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
        buildId: 'authored-index', buildRoot, modes: ['code'] }));
    }
    return { ok: true, status: 0 };
  } });
  assert.equal(applied.state, 'complete');
  assert.equal(applied.suggestion.state, 'indexed-symbol');
  assert.equal(applied.commands.search.at(-1), 'firstUsefulSymbol');
  assert.equal(applied.firstSearch, 'not-performed', 'a suggested indexed name is not a search receipt');
  const trusted = path.join(root, 'trusted-policy.json');
  await fs.writeFile(trusted, '{}');
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_CONFIG: trusted }, async () => {
    const approved = await createFirstSearchPlan({ repoRoot });
    const result = await applyFirstSearchPlan(approved, { execute: async () => {
      await fs.writeFile(trusted, JSON.stringify({ quality: 'max' }));
      return { ok: true, status: 0 };
    } });
    assert.equal(result.state, 'blocked');
    assert.deepEqual(result.completed, ['config', 'index']);
    assert.equal(result.pending[0], 'validate');
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('First-search outcomes admit selected install evidence and suggest bounded real indexed names.');
