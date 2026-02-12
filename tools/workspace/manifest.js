#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';

export async function runWorkspaceManifestCli() {
  const argv = createCli({
    scriptName: 'workspace-manifest',
    options: {
      workspace: { type: 'string' },
      json: { type: 'boolean', default: false }
    }
  }).parse();

  if (!argv.workspace) {
    throw new Error('workspace manifest requires --workspace <path>.');
  }

  const workspaceConfig = loadWorkspaceConfig(argv.workspace);
  const { manifest, manifestPath } = await generateWorkspaceManifest(workspaceConfig, { write: true });
  const payload = {
    ok: true,
    workspacePath: workspaceConfig.workspacePath,
    manifestPath,
    federationCacheRoot: manifest.federationCacheRoot,
    repoSetId: manifest.repoSetId,
    manifestHash: manifest.manifestHash,
    diagnostics: {
      warnings: manifest.diagnostics?.warnings?.length || 0,
      errors: manifest.diagnostics?.errors?.length || 0
    }
  };

  if (argv.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.error('Workspace manifest refreshed');
  console.error(`- workspace: ${payload.workspacePath}`);
  console.error(`- manifest: ${payload.manifestPath}`);
  console.error(`- federationCacheRoot: ${payload.federationCacheRoot}`);
  console.error(`- repoSetId: ${payload.repoSetId}`);
  console.error(`- manifestHash: ${payload.manifestHash}`);
  console.error(`- diagnostics: warnings=${payload.diagnostics.warnings}, errors=${payload.diagnostics.errors}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runWorkspaceManifestCli().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
