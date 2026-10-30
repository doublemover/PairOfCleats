import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

const root = await createImportResolutionTempRoot('architecture-rule-input-cli');
const env = applyTestEnv({ cacheRoot: path.join(root, 'cache'), extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
try {
  const policy = { version: 1, rules: [{ id: 'boundary', type: 'forbiddenImports', from: { anyOf: ['src/app/**'] }, to: {} }] };
  for (const extension of ['json', 'yaml']) {
    const rulesPath = path.join(root, `rules.${extension}`);
    await fs.writeFile(rulesPath, extension === 'json' ? JSON.stringify(policy) : stringifyYaml(policy));
    const result = await spawnSubprocess(process.execPath, [path.join(process.cwd(), 'tools/analysis/architecture-check.js'),
      '--repo', root, '--rules', rulesPath, '--json', '--fail-on-violation'],
    { env, cwd: process.cwd(), timeoutMs: 5000, maxOutputBytes: 128 * 1024, rejectOnNonZeroExit: false });
    assert.equal(result.exitCode, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.version, '1.0.0');
    assert.equal(output.error.code, 'ERR_ARCHITECTURE_RULE_INPUT');
    assert.equal(output.error.ruleId, 'boundary');
    assert.equal(output.error.ruleIndex, 0);
    assert.equal(output.error.propertyPath, 'rules[0].type');
    assert.match(result.stderr, /rules\[0\]\.type.*boundary/);
    assert.ok(!Object.hasOwn(output, 'summary'), 'rejected input cannot masquerade as analyzed complete-clean output');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('architecture JSON/YAML rule rejection CLI test passed');
