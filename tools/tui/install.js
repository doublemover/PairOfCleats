#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { resolveToolRoot } from '../shared/dict-utils.js';
import { readTargetsManifest, resolveHostTargetTriple, resolveTargetForTriple,
  resolveTuiInstallLayout, toPosixRelative } from './targets.js';
import { installTuiGeneration } from './install-generation.js';
import { ensureBuildArtifactAvailable } from './build-support.js';

const argv = createCli({
  scriptName: 'pairofcleats tui install',
  options: {
    json: { type: 'boolean', default: false },
    target: { type: 'string', default: '' },
    build: { type: 'boolean', default: true },
    'install-root': { type: 'string', default: '' },
    'event-log-dir': { type: 'string', default: '' }
  }
}).strictOptions().parse();

const root = resolveToolRoot();

const resolveEventLogDir = ({ layout }) => {
  if (argv['event-log-dir']) {
    return path.resolve(argv['event-log-dir']);
  }
  return layout.logsDir;
};

const main = async () => {
  const { targets } = await readTargetsManifest({ root });
  const triple = argv.target ? String(argv.target).trim() : resolveHostTargetTriple();
  const target = resolveTargetForTriple(targets, triple);
  if (!target) {
    throw new Error(`unsupported target triple: ${triple} (not present in tools/tui/targets.json)`);
  }

  const layout = resolveTuiInstallLayout({
    root, triple, artifactName: target.artifactName, installRoot: argv['install-root']
  });
  const eventLogDir = resolveEventLogDir({ layout });
  const installed = await installTuiGeneration({ root, layout, target, eventLogDir,
    resolveBuild: () => ensureBuildArtifactAvailable({ rootDir: root, triple,
      env: process.env, autoBuild: argv.build !== false }),
    onPhase: phase => { if (!argv.json) process.stderr.write(`[tui-install] ${phase} ${triple}\n`); }
  });
  const { resolvedBuild, checksum, binaryPath, transaction } = installed;
  const { buildArtifact } = resolvedBuild;

  const result = {
    ok: true,
    triple,
    artifact: buildArtifact.artifactPath,
    built: resolvedBuild.built === true,
    installedTo: toPosixRelative(root, binaryPath),
    metadata: toPosixRelative(root, layout.metadataPath),
    eventLogDir: toPosixRelative(root, eventLogDir),
    checksum,
    transaction
  };

  if (argv.json) {
    process.stdout.write(`${stableStringify(result)}\n`);
  } else {
    if (resolvedBuild.built === true) {
      process.stderr.write(`[tui-install] built ${result.artifact}\n`);
    }
    process.stderr.write(`[tui-install] installed ${result.artifact} -> ${result.installedTo}\n`);
    process.stderr.write(`[tui-install] metadata ${result.metadata}\n`);
  }
};

main().catch((error) => {
  console.error(error?.message || error);
  if (error?.tuiInstallPhase) {
    console.error(`[tui-install] phase=${error.tuiInstallPhase} selection=${error.tuiInstallSelection}`);
    if (error.tuiInstallStaging) console.error(`[tui-install] retained recovery generation: ${error.tuiInstallStaging}`);
    console.error('[tui-install] The previous generation is retained. Close a process holding the install manifest and retry if Windows denied publication.');
  }
  process.exit(1);
});
