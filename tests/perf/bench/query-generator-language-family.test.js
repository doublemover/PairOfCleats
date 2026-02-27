#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  QUERY_INTENT_CLASSES,
  generateWeightedQuerySet,
  normalizeIntentWeights,
  resolveLanguageFamily
} from '../../../tools/bench/query-generator.js';

const fixtures = [
  {
    language: 'javascript',
    name: 'createRouter',
    kind: 'function',
    docmeta: {
      signature: 'createRouter(options): Router',
      returnType: 'Router',
      doc: 'Build request routing middleware with retry fallback support.',
      risk: { tags: ['auth', 'retry'] }
    }
  },
  {
    language: 'javascript',
    name: 'registerPlugin',
    kind: 'function',
    docmeta: {
      signature: 'registerPlugin(name, plugin): PluginRegistry',
      returnType: 'PluginRegistry',
      doc: 'Register plugin modules and validate lifecycle hooks.',
      risk: { tags: ['plugin', 'validation'] }
    }
  },
  {
    language: 'typescript',
    name: 'SessionManager',
    kind: 'class',
    docmeta: {
      signature: 'class SessionManager implements Store',
      returnType: 'SessionState',
      doc: 'Manage auth session lifecycle and request throttling behavior.',
      risk: { tags: ['session', 'throttle'] }
    }
  },
  {
    language: 'typescript',
    name: 'resolveConfig',
    kind: 'function',
    docmeta: {
      signature: 'resolveConfig(input: ConfigInput): RuntimeConfig',
      returnType: 'RuntimeConfig',
      doc: 'Resolve module configuration and fallback defaults for handlers.',
      risk: { tags: ['config', 'fallback'] }
    }
  },
  {
    language: 'python',
    name: 'build_client',
    kind: 'function',
    docmeta: {
      signature: 'build_client(config: ClientConfig) -> ApiClient',
      returnType: 'ApiClient',
      doc: 'Create api client with retry and timeout guardrails.',
      risk: { tags: ['timeout', 'network'] }
    }
  },
  {
    language: 'ruby',
    name: 'PaymentGateway',
    kind: 'class',
    docmeta: {
      signature: 'class PaymentGateway < BaseGateway',
      returnType: 'GatewayResponse',
      doc: 'Handle payment authorization behavior and failure fallback.',
      risk: { tags: ['payment', 'fallback'] }
    }
  }
];

const inferredFamily = resolveLanguageFamily({
  languages: fixtures.map((entry) => entry.language)
});
assert.equal(inferredFamily, 'scripting', 'expected scripting family inference for js/ts/python/ruby mix');

const defaultWeights = normalizeIntentWeights({ languageFamily: inferredFamily });
const defaultWeightSum = QUERY_INTENT_CLASSES
  .reduce((sum, intentClass) => sum + defaultWeights[intentClass], 0);
assert.equal(Math.abs(defaultWeightSum - 1) < 1e-9, true, 'default weights should normalize to 1.0');

const weighted = normalizeIntentWeights({
  languageFamily: inferredFamily,
  override: 'symbol=4,type=1,api=3,behavior=2'
});
assert.equal(weighted.symbol > weighted.type, true, 'custom weights should prioritize symbol over type');
assert.equal(weighted.api > weighted.behavior, true, 'custom weights should prioritize api over behavior');

const generated = generateWeightedQuerySet({
  chunks: fixtures,
  count: 40,
  seed: 'ub072-ub092-fixture',
  languageFamily: 'scripting',
  intentWeights: 'symbol=4,type=1,api=3,behavior=2',
  adversarialRatio: 0.2
});

assert.equal(generated.languageFamily, 'scripting', 'expected explicit language family to be honored');
assert.equal(generated.querySet.length, 40, 'expected requested query count');
assert.deepEqual(
  Object.keys(generated.intentWeights).sort(),
  QUERY_INTENT_CLASSES.slice().sort(),
  'expected canonical intent class keys'
);

const countsByIntent = Object.fromEntries(QUERY_INTENT_CLASSES.map((intentClass) => [intentClass, 0]));
let adversarialCount = 0;
for (const entry of generated.querySet) {
  countsByIntent[entry.intentClass] += 1;
  if (entry.variant === 'adversarial') adversarialCount += 1;
}
for (const intentClass of QUERY_INTENT_CLASSES) {
  assert.equal(countsByIntent[intentClass] > 0, true, `expected non-zero coverage for ${intentClass}`);
}
assert.equal(countsByIntent.symbol >= countsByIntent.type, true, 'weighted plan should keep symbol >= type');
assert.equal(countsByIntent.api >= countsByIntent.behavior, true, 'weighted plan should keep api >= behavior');
assert.equal(adversarialCount > 0, true, 'expected adversarial query variants');

const repeat = generateWeightedQuerySet({
  chunks: fixtures,
  count: 40,
  seed: 'ub072-ub092-fixture',
  languageFamily: 'scripting',
  intentWeights: 'symbol=4,type=1,api=3,behavior=2',
  adversarialRatio: 0.2
});
assert.deepEqual(
  repeat.querySet,
  generated.querySet,
  'expected deterministic query set generation for identical seed/input'
);

console.log('bench query generator language family test passed');
