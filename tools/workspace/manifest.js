#!/usr/bin/env node
import { createCli } from '../../src/shared/cli.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { runWorkspaceCliLifecycle } from './cli-lifecycle.js';

export async function runWorkspaceManifestCli(rawArgs = process.argv.slice(2), { signal = null } = {}) {
  const argv = createCli({
    argv: ['node', 'workspace-manifest', ...rawArgs],
    scriptName: 'workspace-manifest',
    options: {
      workspace: { type: 'string' },
      json: { type: 'boolean', default: false }
    }
  }).strictOptions().exitProcess(false).fail(message => { throw new Error(message); }).parse();
  if (argv.help || argv.version) return null;
  signal?.throwIfAborted();

  if (!argv.workspace) {
    throw new Error('workspace manifest requires --workspace <path>.');
  }

  const workspaceConfig = loadWorkspaceConfig(argv.workspace);
  const { manifest, manifestPath } = await generateWorkspaceManifest(workspaceConfig, { write: true, signal });
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
    return payload;
  }

  console.error('Workspace manifest refreshed');
  console.error(`- workspace: ${payload.workspacePath}`);
  console.error(`- manifest: ${payload.manifestPath}`);
  console.error(`- federationCacheRoot: ${payload.federationCacheRoot}`);
  console.error(`- repoSetId: ${payload.repoSetId}`);
  console.error(`- manifestHash: ${payload.manifestHash}`);
  console.error(`- diagnostics: warnings=${payload.diagnostics.warnings}, errors=${payload.diagnostics.errors}`);
  return payload;
}

if (isDirectExecution(import.meta.url)) {
  await runWorkspaceCliLifecycle(runWorkspaceManifestCli, { action: 'manifest' });
}
