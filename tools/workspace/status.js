#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { WORKSPACE_INDEX_MODES, generateWorkspaceManifest } from '../../src/workspace/manifest.js';

const formatModeSummary = (entry, mode) => {
  const modeEntry = entry.indexes[mode];
  const reason = modeEntry?.availabilityReason || 'missing-index-dir';
  const signature = modeEntry?.indexSignatureHash || 'none';
  return `${mode}=${reason} sig=${signature}`;
};

export async function runWorkspaceStatusCli() {
  const argv = createCli({
    scriptName: 'workspace-status',
    options: {
      workspace: { type: 'string' },
      json: { type: 'boolean', default: false }
    }
  }).parse();

  if (!argv.workspace) {
    throw new Error('workspace status requires --workspace <path>.');
  }

  const workspaceConfig = loadWorkspaceConfig(argv.workspace);
  const { manifest, manifestPath } = await generateWorkspaceManifest(workspaceConfig, { write: false });

  if (argv.json) {
    console.log(JSON.stringify({
      ok: true,
      workspacePath: workspaceConfig.workspacePath,
      manifestPath,
      repoSetId: manifest.repoSetId,
      manifestHash: manifest.manifestHash,
      repos: manifest.repos
    }, null, 2));
    return;
  }

  console.error('Workspace status');
  console.error(`- workspace: ${workspaceConfig.workspacePath}`);
  console.error(`- manifest: ${manifestPath}`);
  console.error(`- repoSetId: ${manifest.repoSetId}`);
  console.error(`- manifestHash: ${manifest.manifestHash}`);
  for (const repo of manifest.repos) {
    const label = repo.alias ? `${repo.repoId} (${repo.alias})` : repo.repoId;
    const modeSummary = WORKSPACE_INDEX_MODES.map((mode) => formatModeSummary(repo, mode)).join(' | ');
    console.error(`- ${label}`);
    console.error(`  root=${repo.repoRootCanonical}`);
    console.error(`  ${modeSummary}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runWorkspaceStatusCli().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
