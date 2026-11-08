import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider, selectToolingProviders, listToolingProviders }
  from '../../../src/index/tooling/provider-registry.js';
import { createConfiguredLspProviders } from '../../../src/index/tooling/lsp-provider.js';
import { listLspServerPresets } from '../../../src/index/tooling/lsp-presets.js';

const saved = new Map(TOOLING_PROVIDERS), inputs = { documents: [{ languageId: 'fixture' }], targets: [] };
const server = (id, extra = {}) => ({ id, cmd: 'fixture-command', languages: ['fixture'], ...extra });
const config = servers => ({ autoEnableOnDetect: false, lsp: { enabled: true, autoPresets: false, servers } });
const collision = (fn, id) => assert.throws(fn, error => error.code === 'ERR_TOOLING_PROVIDER_ID_COLLISION'
  && error.providerId === id && error.origins.length === 2 && error.origins.every(origin => typeof origin.source === 'string'));
try {
  TOOLING_PROVIDERS.clear();
  for (const [left, right, id] of [['example', 'EXAMPLE', 'lsp-example'], ['a b', 'a--b', 'lsp-a-b'], ['same', 'same', 'lsp-same']]) {
    const toolingConfig = config([server(left), server(right, { cmd: 'different-command' })]);
    collision(() => createConfiguredLspProviders(toolingConfig), id);
    for (const selection of [{}, { providerIds: [id] }, { providerIds: ['unrelated'] }]) {
      collision(() => selectToolingProviders({ toolingConfig, ...inputs, ...selection }), id);
      collision(() => selectToolingProviders({ toolingConfig: { ...toolingConfig, providerOrder: [id], disabledTools: [id] }, ...inputs, ...selection }), id);
    }
  }
  const provider = id => ({ id, version: '1', capabilities: { supportsVirtualDocuments: true },
    getConfigHash: () => id, async run() { return { byChunkUid: {} }; } });
  registerToolingProvider(provider('builtin'));
  const configuredCollision = config([server('external', { providerId: 'BUILTIN' })]);
  collision(() => listToolingProviders(configuredCollision), 'builtin');
  let builtinError;
  assert.throws(() => selectToolingProviders({ toolingConfig: configuredCollision, ...inputs }), error => {
    builtinError = error; return error.code === 'ERR_TOOLING_PROVIDER_ID_COLLISION';
  });
  assert.deepEqual(builtinError.origins.map(origin => origin.kind), ['registered', 'configured-lsp']);
  assert.deepEqual(builtinError.origins.map(origin => origin.source), ['registry:builtin', 'tooling.lsp.servers[0]']);
  const replacement = provider('builtin'); registerToolingProvider(replacement);
  assert.equal(listToolingProviders()[0], replacement, 'explicit registration still replaces that registry slot');
  registerToolingProvider(replacement); assert.equal(listToolingProviders().length, 1, 'registration remains idempotent');
  TOOLING_PROVIDERS.clear();
  const automatic = listLspServerPresets().find(preset => !preset.explicitOnly && preset.languages?.length);
  assert.ok(automatic, 'an existing automatic profile is the actual composition control');
  const autoConfig = { autoEnableOnDetect: true, enabledTools: [automatic.id], lsp: { enabled: true, servers: [
    server('custom-automatic', { providerId: automatic.id, languages: automatic.languages })
  ] } };
  collision(() => createConfiguredLspProviders(autoConfig), automatic.id);
  const suppressed = createConfiguredLspProviders({ ...autoConfig, lsp: { enabled: true, servers: [
    server(automatic.id, { languages: automatic.languages })
  ] } });
  assert.equal(suppressed.length, 1, 'explicit server ID still suppresses its automatic preset');
  const one = createConfiguredLspProviders(config([server(undefined)]));
  const padded = createConfiguredLspProviders(config([null, {}, server(undefined)]));
  assert.equal(one[0].id, 'lsp-lsp-1'); assert.equal(padded[0].id, one[0].id);
  assert.throws(() => createConfiguredLspProviders(config([server(undefined), server('named')])), { code: 'ERR_TOOLING_PROVIDER_INSTANCE_ID' });
  const profiles = config([server(undefined, { providerId: 'family-a' }), server(undefined, { providerId: 'family-b' })]);
  const reverse = config([...profiles.lsp.servers].reverse());
  assert.deepEqual(createConfiguredLspProviders(profiles).map(value => value.id), ['family-a', 'family-b']);
  for (const candidate of createConfiguredLspProviders(profiles)) {
    const other = createConfiguredLspProviders(reverse).find(value => value.id === candidate.id);
    assert.equal(candidate.getConfigHash({ toolingConfig: profiles }), other.getConfigHash({ toolingConfig: profiles }),
      'explicit instance profile identity does not depend on server-array position');
  }
  const a = provider('family-a'), b = provider('family-b'); registerToolingProvider(a); registerToolingProvider(b);
  for (const providerOrder of [[], ['family-b'], ['family-b', 'family-a'], ['family-a', 'family-b']]) {
    const plans = selectToolingProviders({ ...inputs, toolingConfig: { providerOrder } });
    assert.equal(plans.length, 2); assert.equal(new Set(plans.map(plan => plan.provider)).size, 2);
    assert.ok(plans.every(plan => plan.provider === a || plan.provider === b));
    if (providerOrder.length) assert.equal(plans[0].provider.id, providerOrder[0]);
  }
  assert.deepEqual(selectToolingProviders({ ...inputs, providerIds: ['family-b'] }).map(plan => plan.provider.id), ['family-b']);
  assert.deepEqual(selectToolingProviders({ ...inputs, toolingConfig: { disabledTools: ['family-a'] } }).map(plan => plan.provider.id), ['family-b']);
} finally { TOOLING_PROVIDERS.clear(); for (const [id, value] of saved) TOOLING_PROVIDERS.set(id, value); }
console.log('One normalized provider catalog rejects ambiguous composition before filtering/order, preserving explicit replacement and independent instances.');
