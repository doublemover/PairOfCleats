import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createTuiSettingsSession } from '../../tools/tui/operator/settings.js';
import { loadUserConfig } from '../../tools/dict-utils/config.js';
import { getOperationalGuardrailDiagnostic, resolveOperationalGuardrails } from '../../src/retrieval/operational-guardrails.js';
import { parseJsoncText } from '../../src/shared/jsonc.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';
import { applyTestEnv } from '../helpers/test-env.js';

// UNVALIDATED: actual preview/save and canonical trusted-source loader. No child,
// backend, model or source parser is needed to admit these configuration values.
const root = await makeTempDir('poc-settings-retrieval-'), repo = path.join(root, 'repo');
const file = path.join(repo, '.pairofcleats.json'), trusted = path.join(root, 'trusted.json');
const sessions = [], hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const schemaRevision = hash(await fs.readFile(path.join(process.cwd(), 'docs/config/schema.json')));
const original = '{\n // keep this comment\n "threads": 2, "search": { "hyperlinks": "off" }\n}\n';
const baseEnv = applyTestEnv({ cacheRoot: path.join(root, 'cache'), syncProcess: false, testConfig: {},
  extraEnv: { PAIROFCLEATS_TRUSTED_REPOS: '[]', PAIROFCLEATS_TRUSTED_CONFIG: null } });
const start = async env => {
  const session = createTuiSettingsSession({ toolRoot: process.cwd(), env }); sessions.push(session);
  const scope = await session.selectScope({ kind: 'repo', target: repo });
  return { session, scope, env };
};
const preview = async (owner, keys, value, operation = 'edit') => owner.session.preview({
  scopeId: owner.scope.id, revision: hash(await fs.readFile(file)), schemaRevision,
  operation, path: keys, ...(operation === 'edit' ? { value } : {})
});
const save = (owner, prepared) => owner.session.commit({ scopeId: owner.scope.id,
  previewId: prepared.previewId, confirmed: true });
const effective = async owner => loadUserConfig(repo, {
  env: owner.env, repositoryConfig: parseJsoncText(await fs.readFile(file, 'utf8'))
});
try {
  await fs.mkdir(repo); await fs.writeFile(file, original);
  const owner = await start(baseEnv);
  const invalid = await preview(owner, ['retrieval', 'annCandidateMaxDocCount'], 1000);
  assert.equal(invalid.ok, false); assert.equal(invalid.previewId, undefined);
  assert.match(invalid.validation.errors.join('\n'), /op_guardrail_ann_candidate_cap_out_of_range/);
  assert.equal(await fs.readFile(file, 'utf8'), original);

  // A coordinated reduction is reachable with existing one-field editing.
  for (const [field, value] of [['annCandidateCap', 1000], ['annCandidateMaxDocCount', 1000], ['annCandidateMinDocCount', 1000]]) {
    const prepared = await preview(owner, ['retrieval', field], value);
    assert.equal(prepared.ok, true, JSON.stringify(prepared.validation)); await save(owner, prepared);
    assert.doesNotThrow(() => resolveOperationalGuardrails({ userConfig: loadUserConfig(repo, { env: owner.env }) }));
  }
  const values = resolveOperationalGuardrails({ userConfig: await effective(owner) });
  assert.deepEqual(values, { annCandidateCap: 1000, annCandidateMinDocCount: 1000, annCandidateMaxDocCount: 1000, rrfK: 60 });
  const saved = await fs.readFile(file, 'utf8'); assert.ok(saved.includes('// keep this comment'));
  assert.equal(parseJsoncText(saved).search.hyperlinks, 'off');
  const removal = await preview(owner, ['retrieval', 'annCandidateCap'], undefined, 'remove');
  assert.equal(removal.ok, false); assert.equal(removal.previewId, undefined);
  assert.equal(await fs.readFile(file, 'utf8'), saved);

  await fs.writeFile(file, JSON.stringify({ retrieval: { annCandidateMinDocCount: 1000, annCandidateMaxDocCount: 500 } }));
  const inverted = await preview(owner, ['threads'], 3);
  assert.equal(inverted.ok, false); assert.match(inverted.validation.errors.join('\n'), /op_guardrail_ann_candidate_bounds_invalid/);
  const repaired = await preview(owner, ['retrieval', 'annCandidateMaxDocCount'], 20000);
  assert.equal(repaired.ok, true); await save(owner, repaired);
  const badRrf = await preview(owner, ['search', 'rrf', 'k'], 0);
  assert.equal(badRrf.ok, false); assert.equal(badRrf.previewId, undefined);

  // The partial repository source is accepted when the actual trusted layer
  // completes it; validation must follow merging rather than reject it alone.
  await fs.writeFile(file, original);
  await fs.writeFile(trusted, JSON.stringify({ retrieval: { annCandidateCap: 1000 } }));
  const layered = await start({ ...baseEnv, PAIROFCLEATS_TRUSTED_CONFIG: trusted });
  const completed = await preview(layered, ['retrieval', 'annCandidateMaxDocCount'], 1000);
  assert.equal(completed.ok, true); await save(layered, completed);
  assert.equal(resolveOperationalGuardrails({ userConfig: await effective(layered) }).annCandidateCap, 1000);
  const overridden = await preview(layered, ['retrieval', 'annCandidateCap'], 20000);
  assert.equal(overridden.ok, true, 'trusted cap overrides the proposed repository value');
  await save(layered, overridden);
  assert.equal(parseJsoncText(await fs.readFile(file, 'utf8')).retrieval.annCandidateCap, 20000);
  assert.equal(resolveOperationalGuardrails({ userConfig: await effective(layered) }).annCandidateCap, 1000);

  const pending = await preview(layered, ['threads'], 3), before = await fs.readFile(file, 'utf8');
  assert.equal(pending.ok, true);
  await fs.writeFile(trusted, JSON.stringify({ retrieval: { annCandidateCap: 1000, annCandidateMaxDocCount: 500 } }));
  await assert.rejects(save(layered, pending), { code: 'ERR_TUI_SETTINGS_GUARDRAIL' });
  assert.equal(await fs.readFile(file, 'utf8'), before, 'changed trusted constraints cannot authorize publication');
  await assert.rejects(fs.access(`${file}.bak`), { code: 'ENOENT' });
  await assert.rejects(fs.access(`${file}.edit.lock`), { code: 'ENOENT' });

  assert.equal(getOperationalGuardrailDiagnostic({ guardrailCode: 'op_guardrail_rrf_k_invalid' }), null);
  assert.equal(getOperationalGuardrailDiagnostic(false), null);
} finally { for (const session of sessions) session.dispose(); await rmDirRecursive(root); }
console.log('Settings effective retrieval guardrail controls authored; execution deferred.');
