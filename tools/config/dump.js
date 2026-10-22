#!/usr/bin/env node
import { createRuntimePreview } from '../../src/shared/runtime-envelope/preview.js';
import { sanitizeRuntimeReceipt } from '../../src/shared/runtime-envelope/receipt.js';
import { resolveCurrentProcessRuntimeEnvelope } from '../../src/shared/runtime-envelope/resolve-current-process-envelope.js';
import { createCli } from '../../src/shared/cli.js';
import { getCapabilities } from '../../src/shared/capabilities.js';
import { getEnvConfig } from '../../src/shared/env/runtime.js';
import { getRuntimeCapabilityManifest } from '../../src/shared/runtime-capability-manifest.js';
import { formatEffectiveConfiguration } from './effective.js';
import {
  getCacheRoot,
  getAutoPolicy,
  resolveRepoCacheRootPath,
  resolveRepoConfig
} from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'pairofcleats config dump',
  options: {
    repo: { type: 'string' },
    json: { type: 'boolean', default: false },
    capabilities: { type: 'boolean', default: false }
  }
}).parse();

let configSources = null;
const { repoRoot, userConfig } = resolveRepoConfig(argv.repo, process.cwd(), { onSources: (sources) => { configSources = sources; } });
const envConfig = getEnvConfig();
const policy = await getAutoPolicy(repoRoot, userConfig);
const cacheRoot = (userConfig.cache && userConfig.cache.root) || getCacheRoot();
const capabilities = argv.capabilities ? getCapabilities() : null;
const capabilityManifest = argv.capabilities ? getRuntimeCapabilityManifest({ runtimeCapabilities: capabilities }) : null;
const normalizeSelector = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const mcpModeConfig = normalizeSelector(userConfig?.mcp?.mode);
const mcpModeEnv = normalizeSelector(envConfig.mcpMode);
const mcpMode = mcpModeEnv || mcpModeConfig || 'auto';
const mcpModeSource = mcpModeEnv ? 'env' : (mcpModeConfig ? 'config' : 'default');
const preview = await createRuntimePreview({ repoRoot, userConfig, policy, configSources, envelope: resolveCurrentProcessRuntimeEnvelope({ userConfig, autoPolicy: policy }) });
const payload = sanitizeRuntimeReceipt({
  ...preview,
  repoRoot,
  userConfig,
  policy,
  derived: {
    cacheRoot,
    repoCacheRoot: resolveRepoCacheRootPath(repoRoot, userConfig),
    mcp: {
      mode: mcpMode,
      modeSource: mcpModeSource,
      sdkAvailable: !!capabilities?.mcp?.sdk
    },
    ...(capabilityManifest ? { capabilityManifest } : {})
  }
});

if (argv.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.error(formatEffectiveConfiguration({ ok: true, repoRoot, configSources,
    preview, ignored: (configSources?.discardedAuthorityPaths || []).map(field => ({ path: field,
      reason: 'repository-owned-execution-or-storage-authority-discarded', nextAction: 'Review user-owned trusted policy or explicitly review repository trust.' })) }));
  console.error('Configuration preview (not a live-run receipt)');
  console.error(`- repo: ${repoRoot}`);
  console.error(`- cache root: ${payload.derived.cacheRoot}`);
  console.error(`- repo cache: ${payload.derived.repoCacheRoot}`);
  console.error(`- quality: ${payload.policy.quality.value} (${payload.policy.quality.source})`);
  console.error(`- mcp mode: ${payload.derived.mcp.mode} (${payload.derived.mcp.modeSource})`);
  console.error(`- model selected: ${payload.embeddings.selectedModel} (${payload.embeddings.modelSource}); observed model: unknown`);
  if (argv.capabilities) console.error(`- mcp sdk: ${payload.derived.mcp.sdkAvailable ? 'available' : 'missing'}`);
}
