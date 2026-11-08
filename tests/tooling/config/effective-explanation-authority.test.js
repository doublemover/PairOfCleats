#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { explainEffectiveConfiguration, formatEffectiveConfiguration } from '../../../tools/config/effective.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { loadUserConfig } from '../../../tools/dict-utils/config.js';
import { buildConfigurationDump } from '../../../tools/config/dump-payload.js';

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
    const selected = path.join(root, 'selected.json');
    await fs.writeFile(selected, JSON.stringify({ quality: 'fast', indexing: { embeddings: { enabled: true, model: 'fixture-selected-model' } } }));
    const selectedEnv = { PAIROFCLEATS_TRUSTED_REPOS: '', PAIROFCLEATS_TRUSTED_CONFIG: '',
      PAIROFCLEATS_EMBEDDINGS: 'off', PAIROFCLEATS_MODELS_DIR: path.join(root, 'selected-models'),
      PAIROFCLEATS_CACHE_ROOT: path.join(root, 'selected-cache'), PAIROFCLEATS_MCP_MODE: 'stdio' };
    const dump = await buildConfigurationDump({ repoRoot: root, configPath: selected, env: selectedEnv });
    assert.equal(dump.ok, true, 'explicit selected config does not read invalid repository default');
    assert.equal(dump.configSources.files[0].path, selected);
    assert.equal(dump.policy.quality.value, 'fast');
    assert.equal(dump.selected.quality.value, 'fast');
    assert.equal(dump.embeddings.selectedModel, 'fixture-selected-model');
    assert.equal(dump.embeddings.resolvedEmbeddingMode, 'off');
    assert.equal(dump.paths.models.selected, selectedEnv.PAIROFCLEATS_MODELS_DIR);
    assert.ok(dump.derived.repoCacheRoot.startsWith(selectedEnv.PAIROFCLEATS_CACHE_ROOT));
    assert.equal(dump.derived.mcp.mode, 'stdio');
    assert.equal(dump.derived.mcp.sdkAvailable, null, 'unrequested capability probe cannot be labeled missing');
    assert.equal(dump.diagnostic.environmentScope, 'explicit-preview-input');
    assert.equal(dump.diagnostic.liveRunReceipt, false);
    assert.equal((await buildConfigurationDump({ repoRoot: root, configPath: path.join(root, 'missing-dump.json') })).ok, false);
    const guardrailConfig = path.join(root, 'guardrail.json');
    const invalidCombination = JSON.stringify({ retrieval: { annCandidateMaxDocCount: 1000 } });
    await fs.writeFile(guardrailConfig, invalidCombination);
    const guardrailEnv = applyTestEnv({ syncProcess: false, testConfig: {}, extraEnv: selectedEnv });
    const rejected = await explainEffectiveConfiguration({ repoRoot: root, configPath: guardrailConfig, env: guardrailEnv });
    assert.equal(rejected.ok, false); assert.equal(rejected.validation.schema, 'accepted');
    assert.equal(rejected.validation.effective, 'rejected'); assert.equal(rejected.validation.runtime, 'not-probed');
    assert.equal(rejected.errorCode, 'op_guardrail_ann_candidate_cap_out_of_range');
    assert.equal(rejected.errors[0].code, rejected.errorCode);
    assert.match(formatEffectiveConfiguration(rejected), /retrieval.annCandidateCap/);
    assert.match(formatEffectiveConfiguration(rejected), /op_guardrail_ann_candidate_cap_out_of_range/);
    const deniedDump = await buildConfigurationDump({ repoRoot: root, configPath: guardrailConfig, env: guardrailEnv, includeCapabilities: true }, {
      capabilities() { assert.fail('rejected effective configuration cannot authorize a requested capability probe'); }
    });
    assert.equal(deniedDump.ok, false); assert.deepEqual(deniedDump.errors, rejected.errors);
    assert.equal(await fs.readFile(guardrailConfig, 'utf8'), invalidCombination, 'explanation is read-only');
    const trusted = path.join(suite, `${path.basename(root)}-trusted-guardrail.json`);
    try {
      await fs.writeFile(trusted, JSON.stringify({ retrieval: { annCandidateCap: 1000 } }));
      const completed = await explainEffectiveConfiguration({ repoRoot: root, configPath: guardrailConfig,
        env: { ...guardrailEnv, PAIROFCLEATS_TRUSTED_CONFIG: trusted } });
      assert.equal(completed.ok, true); assert.equal(completed.validation.schema, 'accepted');
      assert.equal(completed.configSources.trustedMerge, true);
      assert.equal(completed.userConfig.retrieval.annCandidateCap, 1000);
      assert.equal(completed.validation.runtime, 'not-probed');
    } finally { await fs.rm(trusted, { force: true }); }
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Effective config explanation distinguishes authority and readiness.');
