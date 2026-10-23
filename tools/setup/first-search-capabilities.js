import fs from 'node:fs';
import { SETUP_OPTIONS } from '../shared/operator-cli-options.js';
import { normalizeEmbeddingProvider } from '../../src/shared/onnx-embeddings/config.js';
import { createToolInstallPreview } from '../tooling/install-preview.js';
import { getCurrentBuildInfo, getIndexDir } from '../shared/dict-utils.js';

/** Directory replacement invalidates approval even when config bytes match. */
export const identifySetupTarget = repoRoot => {
  const canonical = fs.realpathSync(repoRoot);
  const stat = fs.statSync(canonical, { bigint: true });
  if (!stat.isDirectory()) throw new Error('First-search target must be an existing directory.');
  return { canonical, device: String(stat.dev), inode: String(stat.ino), createdNs: String(stat.birthtimeNs) };
};

export const describeFirstSearchCapabilities = ({ repoRoot, userConfig, profile, backend, tooling, prerequisitePlans }) => {
  const provider = normalizeEmbeddingProvider(userConfig.indexing?.embeddings?.provider, { strict: true });
  const tools = createToolInstallPreview({ tools: tooling, scope: 'cache', allowFallback: false }, {
    provisioning: ({ tool }) => prerequisitePlans.find(plan => plan.toolId === tool.id)
  });
  let existingIndex;
  try {
    const current = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'code' });
    existingIndex = { state: current ? 'pointer-present' : 'no-current-generation', buildId: current?.buildId || null,
      indexDir: getIndexDir(repoRoot, 'code', userConfig), verification: 'pointer-inventory-only', validation: 'not-performed' };
  } catch (error) {
    if (error.code !== 'ERR_INDEX_FORMAT_UNSUPPORTED') throw error;
    existingIndex = { state: 'incompatible', code: error.code, buildId: null, indexDir: null,
      verification: 'pointer-inventory-only', validation: 'not-performed', nextAction: 'Build a current-format generation for this exact target.' };
  }
  return {
    choices: { profiles: [...SETUP_OPTIONS.profile.choices], backends: [...SETUP_OPTIONS.backend.choices] },
    selected: { profile, backend, provider: profile === 'semantic' ? provider : null, mode: 'code' },
    existingIndex,
    tooling: tools,
    readiness: [
      { id: 'sparse-search', requested: true, state: 'not-validated' },
      { id: 'semantic-search', requested: profile === 'semantic', state: profile === 'semantic' ? 'not-probed' : 'not-requested',
        modelInference: 'not-probed' },
      { id: 'backend', requested: true, backend, state: 'not-probed' },
      ...tooling.map(tool => ({ id: `tool:${tool.id}`, requested: true, state: 'not-probed',
        executable: 'not-probed', protocol: 'not-probed', project: 'not-probed',
        languages: tool.languages || [], capabilities: tool.capabilities || [] }))
    ]
  };
};

export const describeAppliedFirstSearchCapabilities = (plan, outcome) => plan.capabilities.readiness.map(item => {
  if (item.state === 'not-requested') return item;
  const complete = id => outcome.completed.includes(id);
  if (item.id.startsWith('tool:')) return { ...item, state: complete('tooling') ? 'install-command-completed' : 'pending',
    nextAction: 'Inspect the selected tool install receipt, then qualify its protocol and project consumer.' };
  if (item.id === 'semantic-search') return { ...item,
    state: (complete('models') || plan.modelReadiness.present === true) && complete('validate') ? 'assets-and-index-command-completed' : 'pending',
    nextAction: 'Run the target-qualified search command to verify selected-model inference and first results.' };
  return { ...item, state: complete('validate') ? 'index-validation-command-completed' : 'pending',
    nextAction: 'Run the target-qualified search command to verify first results.' };
});
