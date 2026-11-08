#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { describeWorkspaceReadiness } from '../../tools/workspace/diagnostics.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { runNode } from '../helpers/run-node.js';

const checkout = process.cwd();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-workspace-partial-diagnosis-'));
const cacheRoot = path.join(root, 'cache');
const env = applyTestEnv({ cacheRoot, embeddings: 'off' });
const workspacePath = path.join(root, 'workspace.jsonc');
try {
  for (const name of ['good', 'bad', 'unrelated']) await fs.mkdir(path.join(root, name));
  await fs.writeFile(path.join(root, 'bad', '.pairofcleats.json'), '{ invalid member config');
  await fs.writeFile(path.join(root, 'unrelated', '.pairofcleats.json'), '{ invalid unrelated config');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache',
    repos: [{ root: './good', alias: 'good' }, { root: './bad', alias: 'bad' }] }));
  const workspace = loadWorkspaceConfig(workspacePath);
  await assert.rejects(generateWorkspaceManifest(workspace, { write: false }), /parse|JSON|Invalid/i);
  const partial = await generateWorkspaceManifest(workspace, { write: false, allowPartial: true });
  assert.equal(partial.manifest.repos.length, 1);
  assert.equal(partial.manifest.diagnostics.errors.length, 1);
  const diagnosis = describeWorkspaceReadiness(workspace, partial.manifest);
  const failed = diagnosis.nextActions.filter(entry => entry.alias === 'bad');
  assert.equal(failed.every(entry => entry.state === 'incompatible' && entry.reason === 'member-inspection-failed'), true);
  assert.equal(failed.every(entry => entry.command.includes('validate') && entry.command.includes('config')), true);
  assert.equal(diagnosis.modes.code.selected, 2);
  assert.equal(diagnosis.modes.code.incompatible, 1);
  await assert.rejects(fs.stat(cacheRoot), { code: 'ENOENT' });
  await fs.mkdir(path.dirname(partial.manifestPath), { recursive: true });
  await fs.writeFile(partial.manifestPath, 'previous inventory remains intact');
  await assert.rejects(generateWorkspaceManifest(workspace, { write: true, allowPartial: true }));
  assert.equal(await fs.readFile(partial.manifestPath, 'utf8'), 'previous inventory remains intact');
  for (const leaf of ['status', 'catalog']) {
    const result = runNode([path.join(checkout, 'bin/pairofcleats.js'), 'workspace', leaf, '--workspace', workspacePath, '--json'],
      `workspace ${leaf} partial diagnostics`, path.join(root, 'unrelated'), env,
      { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.modes.code.selected, 2);
    assert.equal(payload.nextActions.filter(entry => entry.alias === 'good').every(entry => entry.state === 'missing'), true);
    assert.equal(payload.nextActions.filter(entry => entry.alias === 'bad').every(entry => entry.reason === 'member-inspection-failed'), true);
  }
  assert.equal(await fs.readFile(partial.manifestPath, 'utf8'), 'previous inventory remains intact');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Workspace read-only diagnosis isolates failed members without publishing partial manifests.');
