#!/usr/bin/env node
import { createCli } from '../../src/shared/cli.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { WORKSPACE_INDEX_MODES, generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { getRepoCacheRoot } from '../shared/dict-utils.js';

const main = async () => {
  const argv = createCli({
    scriptName: 'workspace-catalog',
    options: {
      workspace: { type: 'string' },
      json: { type: 'boolean', default: false }
    }
  }).parse();

  if (!argv.workspace || typeof argv.workspace !== 'string') {
    throw new Error('workspace catalog requires --workspace <path>.');
  }
  const workspaceConfig = loadWorkspaceConfig(argv.workspace);
  const { manifest, manifestPath } = await generateWorkspaceManifest(workspaceConfig, { write: true });
  const manifestByRepo = new Map((manifest.repos || []).map((entry) => [entry.repoId, entry]));

  const repos = workspaceConfig.repos
    .slice()
    .sort((a, b) => a.repoId.localeCompare(b.repoId))
    .map((repo) => {
      const manifestRepo = manifestByRepo.get(repo.repoId) || {};
      const modes = {};
      for (const mode of WORKSPACE_INDEX_MODES) {
        const modeEntry = manifestRepo.indexes?.[mode] || null;
        modes[mode] = modeEntry
          ? {
            availabilityReason: modeEntry.availabilityReason || null,
            indexSignatureHash: modeEntry.indexSignatureHash || null,
            cohortKey: modeEntry.cohortKey || null,
            compatibilityKey: modeEntry.compatibilityKey || null,
            indexDir: modeEntry.indexDir || null
          }
          : null;
      }
      return {
        repoId: repo.repoId,
        alias: repo.alias || null,
        enabled: repo.enabled !== false,
        priority: Number(repo.priority || 0),
        tags: Array.isArray(repo.tags) ? repo.tags : [],
        repoRootCanonical: repo.repoRootCanonical,
        repoCacheRoot: getRepoCacheRoot(repo.repoRootCanonical),
        pointer: manifestRepo.pointer || null,
        modes
      };
    });

  const payload = {
    ok: true,
    workspacePath: workspaceConfig.workspacePath,
    workspaceDir: workspaceConfig.workspaceDir,
    workspaceName: workspaceConfig.name || null,
    repoSetId: workspaceConfig.repoSetId,
    cacheRoots: {
      federationCacheRoot: workspaceConfig.federationCacheRoot,
      workspaceManifestPath: manifestPath
    },
    manifest: {
      manifestHash: manifest.manifestHash,
      generatedAt: manifest.generatedAt,
      diagnostics: manifest.diagnostics || { warnings: [], errors: [] }
    },
    repos
  };

  if (argv.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.error('Workspace catalog');
  console.error(`- workspace: ${payload.workspacePath}`);
  console.error(`- repoSetId: ${payload.repoSetId}`);
  console.error(`- manifest: ${payload.cacheRoots.workspaceManifestPath}`);
  console.error(`- manifestHash: ${payload.manifest.manifestHash}`);
  for (const repo of payload.repos) {
    console.error(`- ${repo.repoId} (${repo.alias || 'no-alias'}) enabled=${repo.enabled} priority=${repo.priority}`);
    for (const mode of WORKSPACE_INDEX_MODES) {
      const modeEntry = repo.modes[mode];
      const reason = modeEntry?.availabilityReason || 'missing';
      console.error(`  - ${mode}: ${reason}`);
    }
  }
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
