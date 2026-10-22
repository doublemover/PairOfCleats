#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { explainEffectiveConfiguration, formatEffectiveConfiguration } from '../../../tools/config/effective.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { loadUserConfig } from '../../../tools/dict-utils/config.js';

const suite = path.join(process.cwd(), '.tmp', 'tasks', 'effective-explanation-authority');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
try {
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '', PAIROFCLEATS_TRUSTED_CONFIG: '' }, async () => {
    const report = await explainEffectiveConfiguration({ repoRoot: root });
    assert.equal(report.ok, true);
    assert.equal(report.validation.runtime, 'not-probed');
    assert.equal(report.selected.backend.state, 'selection-deferred');
    assert.equal(report.selected.embeddingProvider.value, 'xenova');
    assert.match(formatEffectiveConfiguration(report), /selected embedding provider: xenova/);
    assert.match(formatEffectiveConfiguration(report), /backend: selection-deferred/);
    const missing = await explainEffectiveConfiguration({ repoRoot: root, configPath: path.join(root, 'missing.json') });
    assert.equal(missing.ok, false);
    assert.equal(missing.errorCode, 'ENOENT');
    await fs.writeFile(path.join(root, '.pairofcleats.json'), JSON.stringify({ tooling: { autoInstallOnDetect: true } }));
    const filtered = await explainEffectiveConfiguration({ repoRoot: root });
    assert.equal(filtered.ok, true);
    assert.ok(filtered.ignored.some(item => item.path === 'tooling.autoInstallOnDetect'));
    assert.match(formatEffectiveConfiguration(filtered), /tooling.autoInstallOnDetect/);
    assert.equal(filtered.validation.artifacts, 'not-probed');
    const before = await fs.readFile(path.join(root, '.pairofcleats.json'), 'utf8');
    const preview = loadUserConfig(root, { repositoryConfig: { threads: 1, tooling: { autoInstallOnDetect: true } } });
    assert.equal(preview.threads, 1);
    assert.equal(preview.tooling.autoInstallOnDetect, undefined, 'in-memory preview retains canonical repository authority filtering');
    assert.equal(await fs.readFile(path.join(root, '.pairofcleats.json'), 'utf8'), before);
    await fs.writeFile(path.join(root, '.pairofcleats.json'), '{"threads":"secret-looking-invalid-type"}');
    const invalid = await explainEffectiveConfiguration({ repoRoot: root });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.errorCode, 'ERR_REPO_CONFIG_INVALID');
    assert.equal(invalid.errors[0].path, '/threads');
    assert.equal(JSON.stringify(invalid).includes('secret-looking-invalid-type'), false, 'schema errors retain path/code without source values');
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Effective config explanation distinguishes authority and readiness.');
