import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadUserConfig } from '../../tools/shared/dict-utils.js';
import { normalizeSearchOptions } from '../../src/retrieval/cli/normalize-options.js';
import { parseSearchArgs } from '../../src/retrieval/cli-args.js';
import { computeRelationBoost } from '../../src/retrieval/scoring/relation-boost.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { createRelationBoostIndex, createRelationBoostPipeline } from './helpers/relation-boost-fixture.js';

const { dir } = await prepareIsolatedTestCacheDir('relation-boost-zero-config');
const env = applyTestEnv({ testConfig: {}, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const chunk = { id: 0, file: 'match.js', lang: 'javascript', tokens: ['cat'],
  codeRelations: { calls: [['run', 'cat']], usages: ['cat'] } };
const idx = createRelationBoostIndex({ chunks: [chunk,
  { id: 1, file: 'other.js', lang: 'javascript', tokens: ['cat'], codeRelations: { calls: [], usages: [] } }] });
const optionsFor = config => normalizeSearchOptions({ argv: parseSearchArgs(['cat']),
  rawArgs: ['cat'], rootDir: dir, userConfig: config, metricsDir: dir, policy: {} });
const run = relationBoost => createRelationBoostPipeline({ query: 'cat', queryTokens: ['cat'], relationBoost,
  rankSqliteFts: () => [{ idx: 0, score: 2 }, { idx: 1, score: 2.2 }] })(idx, 'code', null);

for (const [name, config, weights, expected] of [
  ['perCall', { enabled: true, perCall: 0 }, [0, 0.1, 1.5], 0.1],
  ['perUse', { enabled: true, perUse: 0 }, [0.25, 0, 1.5], 0.25],
  ['maxBoost', { enabled: true, maxBoost: 0 }, [0.25, 0.1, 0], 0],
  ['allZero', { enabled: true, perCall: 0, perUse: 0, maxBoost: 0 }, [0, 0, 0], 0],
  ['disabled', { enabled: false, perCall: 0, perUse: 0, maxBoost: 0 }, [0, 0, 0], 0],
  ['defaults', { enabled: true }, [0.25, 0.1, 1.5], 0.35],
  ['negative', { enabled: true, perCall: -1, perUse: -1, maxBoost: -1 }, [0.25, 0.1, 1.5], 0.35]
]) {
  const repo = path.join(dir, name); await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({ retrieval: { relationBoost: config } }));
  const loaded = loadUserConfig(repo, { env });
  assert.deepEqual(loaded.retrieval.relationBoost, config, 'the schema/loader preserves declared numbers');
  const normalized = optionsFor(loaded);
  const cliConfig = { enabled: normalized.relationBoostEnabled, perCall: normalized.relationBoostPerCall,
    perUse: normalized.relationBoostPerUse, maxBoost: normalized.relationBoostMaxBoost };
  assert.deepEqual([cliConfig.perCall, cliConfig.perUse, cliConfig.maxBoost], weights, `${name}: CLI values`);
  for (const [route, effective] of [['CLI', cliConfig], ['direct pipeline', loaded.retrieval.relationBoost]]) {
    const hits = await run(effective);
    assert.equal(hits.length, 2, `${name}/${route}: boosting must preserve both hits`);
    const hit = hits.find(entry => entry.id === 0), other = hits.find(entry => entry.id === 1);
    assert.ok(Math.abs(hit.score - (2 + expected)) < 1e-12, `${name}/${route}: configured score contribution`);
    assert.equal(other.score, 2.2);
    assert.deepEqual(hits.map(entry => entry.id), expected > 0.2 ? [0, 1] : [1, 0], `${name}/${route}: ranking`);
    if (config.enabled) {
      const explain = hit.scoreBreakdown.relation;
      assert.deepEqual([explain.perCall, explain.perUse, explain.maxBoost], weights);
      assert.equal(explain.callMatches, 1); assert.equal(explain.usageMatches, 1);
      assert.equal(explain.boost, expected);
      assert.equal(explain.rawBoost, weights[0] + weights[1]);
    } else assert.equal(hit.scoreBreakdown.relation, null);
  }
}

for (const value of [null, false, true, [], [0], {}, '', ' ', NaN, Infinity, -1]) {
  const config = { enabled: true, perCall: value, perUse: value, maxBoost: value };
  const direct = computeRelationBoost({ chunk, queryTokens: ['cat'], config });
  assert.deepEqual([direct.perCall, direct.perUse, direct.maxBoost], [0.25, 0.1, 1.5]);
  const normalized = optionsFor({ retrieval: { relationBoost: config } });
  assert.deepEqual([normalized.relationBoostPerCall, normalized.relationBoostPerUse,
    normalized.relationBoostMaxBoost], [0.25, 0.1, 1.5]);
  const hit = (await run(config)).find(entry => entry.id === 0);
  assert.equal(hit.score, 2.35, 'invalid values use positive defaults consistently');
}
const numericStrings = computeRelationBoost({ chunk, queryTokens: ['cat'],
  config: { enabled: true, perCall: '0', perUse: '0.2', maxBoost: '0.1', maxExplainTokens: 0 } });
assert.equal(numericStrings.rawBoost, 0.2); assert.equal(numericStrings.boost, 0.1);
assert.equal(numericStrings.maxExplainTokens, 12, 'list lengths remain strictly positive');
console.log('zero relation-boost configuration, normalization, ranking and explanation checks passed');
