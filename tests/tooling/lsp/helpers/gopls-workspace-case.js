import path from 'node:path';

export const goplsSampleDocText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';

const toIdPart = (value) => String(value || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export const buildGoplsWorkspaceInputs = ({
  scenario,
  partitions,
  docText = goplsSampleDocText
}) => {
  const documents = [];
  const targets = [];
  const chunkUids = {};
  for (const [index, partition] of partitions.entries()) {
    const service = partition.service;
    const suffix = partition.suffix;
    const virtualPath = `.poc-vfs/${service}/src/sample.go#seg:${scenario}-${suffix}.txt`;
    const chunkUid = `ck64:v1:test:${service}/src/sample.go:${scenario}:${suffix}`;
    chunkUids[partition.key || suffix] = chunkUid;
    documents.push({
      virtualPath,
      text: docText,
      languageId: 'go',
      effectiveExt: '.go',
      docHash: `hash-${scenario}-${suffix}`
    });
    targets.push({
      chunkRef: {
        docId: index,
        chunkUid,
        chunkId: `chunk_${toIdPart(scenario)}_${toIdPart(suffix)}`,
        file: `${service}/src/sample.go`,
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath,
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Add', kind: 'function' },
      languageId: 'go'
    });
  }
  return {
    documents,
    targets,
    kinds: ['types'],
    chunkUids
  };
};

export const buildGoplsWorkspaceContext = ({
  root = process.cwd(),
  tempRoot,
  providerId = 'lsp-gopls',
  serverId = 'gopls',
  probePath,
  probeArgs = [],
  cache = { enabled: false },
  serverConfig = {}
}) => ({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: [providerId],
    lsp: {
      enabled: true,
      servers: [{
        id: serverId,
        preset: 'gopls',
        cmd: process.execPath,
        args: [path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js'), '--mode', 'go'],
        languages: ['go'],
        uriScheme: 'poc-vfs',
        preflightRuntimeRequirements: [],
        goWorkspaceModuleCmd: process.execPath,
        goWorkspaceModuleArgs: [probePath, ...probeArgs],
        goWorkspaceWarmup: false,
        ...serverConfig
      }]
    }
  },
  cache
});
