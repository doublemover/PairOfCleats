import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../src/index/tooling/providers/index.js';
import { prepareIsolatedTestCacheDir } from './test-cache.js';

const stringifySafePath = (value) => String(value || '').replace(/[\\/]/g, '_');

const normalizeWorkspaceFiles = (files) => (
  Array.isArray(files)
    ? files.filter((entry) => entry && typeof entry === 'object')
    : []
);

export const createLspProviderTempRepo = async ({
  repoRoot = process.cwd(),
  name,
  directories = [],
  files = []
}) => {
  const fixtureName = String(name || 'lsp-provider-fixture').trim() || 'lsp-provider-fixture';
  const { dir: tempRoot } = await prepareIsolatedTestCacheDir(fixtureName, {
    root: repoRoot,
    clean: true
  });
  for (const relativeDir of Array.isArray(directories) ? directories : []) {
    const normalizedDir = String(relativeDir || '').trim();
    if (!normalizedDir) continue;
    await fs.mkdir(path.join(tempRoot, normalizedDir), { recursive: true });
  }
  for (const file of normalizeWorkspaceFiles(files)) {
    const relativePath = String(file.path || '').trim();
    if (!relativePath) continue;
    const absolutePath = path.join(tempRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, String(file.content || ''), 'utf8');
  }
  return tempRoot;
};

export const resolveLspFixtureCommand = (commandName, { repoRoot = process.cwd() } = {}) => path.join(
  repoRoot,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? `${commandName}.cmd` : commandName
);

export const buildSingleSymbolInputs = ({
  scenarioName,
  virtualPath,
  text,
  languageId,
  effectiveExt,
  symbolName,
  symbolKind = 'function',
  chunkId = null,
  kinds = ['types']
}) => {
  const baseScenario = String(scenarioName || 'single-symbol').trim() || 'single-symbol';
  const normalizedPath = String(virtualPath || '').trim();
  const docText = String(text || '');
  const normalizedExt = String(effectiveExt || path.extname(normalizedPath) || '').trim();
  const chunkUid = `ck64:v1:test:${normalizedPath}:${baseScenario}`;
  const chunkRefId = chunkId || `chunk_${stringifySafePath(baseScenario)}`;
  return {
    chunkUid,
    kinds: Array.isArray(kinds) && kinds.length ? kinds : ['types'],
    documents: [{
      virtualPath: normalizedPath,
      text: docText,
      languageId,
      effectiveExt: normalizedExt,
      docHash: `hash-${stringifySafePath(baseScenario)}`
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: chunkRefId,
        file: normalizedPath,
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: normalizedPath,
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: symbolName, kind: symbolKind },
      languageId
    }]
  };
};

export const runDedicatedProviderFixture = async ({
  tempRoot,
  providerId,
  providerConfigKey,
  providerConfig,
  inputs,
  toolingConfig = {},
  strict = true
}) => {
  registerDefaultToolingProviders();
  const mergedProviderConfig = {
    enabled: true,
    ...((providerConfig && typeof providerConfig === 'object') ? providerConfig : {})
  };
  return runToolingProviders({
    strict,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      ...toolingConfig,
      enabledTools: [providerId],
      [providerConfigKey]: mergedProviderConfig
    },
    cache: {
      enabled: false
    }
  }, {
    documents: inputs.documents,
    targets: inputs.targets,
    kinds: inputs.kinds
  });
};
