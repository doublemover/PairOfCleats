#!/usr/bin/env node
import { createCli } from '../../src/shared/cli.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { WORKSPACE_INDEX_MODES, generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { describeWorkspaceReadiness } from './diagnostics.js';

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
  const { manifest, manifestPath } = await generateWorkspaceManifest(workspaceConfig, { write: false, allowPartial: true });
  const inspectionOk = manifest.diagnostics.errors.length === 0;
  if (!inspectionOk) process.exitCode = 1;
  const readiness = describeWorkspaceReadiness(workspaceConfig, manifest);

  if (argv.json) {
    console.log(JSON.stringify({
      ok: inspectionOk,
      workspacePath: workspaceConfig.workspacePath,
      manifestPath,
      repoSetId: manifest.repoSetId,
      manifestHash: manifest.manifestHash,
      repos: manifest.repos,
      diagnostics: manifest.diagnostics,
      ...readiness
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
  for (const [mode, summary] of Object.entries(readiness.modes)) console.error(`- ${mode}: ${summary.state}; ${summary.ready}/${summary.selected} members available; ${summary.disabled} disabled`);
  for (const action of readiness.nextActions.filter(entry => entry.command)) {
    console.error(`  next (${action.alias || action.repoId}/${action.mode}): ${action.command.map(value => JSON.stringify(value)).join(' ')}`);
  }
  for (const failure of manifest.diagnostics.errors) console.error(`  inspection (${failure.repoId}): ${failure.code}: ${failure.message}`);
  console.error(readiness.qualification);
  console.error(`  search: ${readiness.nextCommands.search.map(value => JSON.stringify(value)).join(' ')}`);
}

if (isDirectExecution(import.meta.url)) {
  runWorkspaceStatusCli().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
