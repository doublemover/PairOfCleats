#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { resolveToolRoot } from '../shared/dict-utils.js';

const ROOT = resolveToolRoot();
const REGISTRY_PATH = path.join(ROOT, 'docs', 'tooling', 'generated-surfaces.json');

const parseArgs = () => createCli({
  scriptName: 'pairofcleats generated-surfaces',
  options: {
    root: { type: 'string' },
    check: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    surface: { type: 'string' }
  }
})
  .strictOptions()
  .parse();

const normalizeSurfaces = (registry, root, surfaceId = '') => {
  const surfaces = Array.isArray(registry?.surfaces) ? registry.surfaces : [];
  const filtered = surfaceId
    ? surfaces.filter((surface) => surface?.id === surfaceId)
    : surfaces;
  return filtered.map((surface) => ({
    ...surface,
    outputs: Array.isArray(surface.outputs) ? surface.outputs : [],
    resolvedOutputs: (Array.isArray(surface.outputs) ? surface.outputs : []).map((entry) => path.resolve(root, entry))
  }));
};

const extractScriptPath = (command) => {
  const match = String(command || '').match(/^node\s+([^\s]+\.js)\b/);
  return match ? match[1] : null;
};

const main = async () => {
  const argv = parseArgs();
  const root = path.resolve(argv.root || ROOT);
  const registryPath = path.resolve(root, path.relative(ROOT, REGISTRY_PATH));
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const surfaces = normalizeSurfaces(registry, root, argv.surface);

  if (argv.surface && surfaces.length === 0) {
    console.error(`Unknown generated surface id: ${argv.surface}`);
    process.exit(1);
  }

  if (argv.check) {
    const seenIds = new Set();
    const seenOutputs = new Set();
    for (const surface of surfaces) {
      if (!surface?.id || typeof surface.id !== 'string') {
        console.error('generated surfaces check failed: every surface must have a string id');
        process.exit(1);
      }
      if (seenIds.has(surface.id)) {
        console.error(`generated surfaces check failed: duplicate id ${surface.id}`);
        process.exit(1);
      }
      seenIds.add(surface.id);
      if (!surface.owner || !surface.validationMode || !surface.freshnessExpectation) {
        console.error(`generated surfaces check failed: ${surface.id} is missing required ownership/validation metadata`);
        process.exit(1);
      }
      if (!surface.refresh?.command) {
        console.error(`generated surfaces check failed: ${surface.id} is missing a refresh command`);
        process.exit(1);
      }
      const refreshScript = extractScriptPath(surface.refresh.command);
      if (refreshScript && !fs.existsSync(path.resolve(root, refreshScript))) {
        console.error(`generated surfaces check failed: ${surface.id} refresh script missing: ${refreshScript}`);
        process.exit(1);
      }
      const auditScript = extractScriptPath(surface.audit?.command);
      if (auditScript && !fs.existsSync(path.resolve(root, auditScript))) {
        console.error(`generated surfaces check failed: ${surface.id} audit script missing: ${auditScript}`);
        process.exit(1);
      }
      for (const [index, output] of surface.outputs.entries()) {
        if (!output || typeof output !== 'string') {
          console.error(`generated surfaces check failed: ${surface.id} has an invalid output at index ${index}`);
          process.exit(1);
        }
        if (seenOutputs.has(output)) {
          console.error(`generated surfaces check failed: duplicate output path ${output}`);
          process.exit(1);
        }
        seenOutputs.add(output);
        if (surface.committed && !fs.existsSync(path.resolve(root, output))) {
          console.error(`generated surfaces check failed: committed output missing for ${surface.id}: ${output}`);
          process.exit(1);
        }
      }
    }
    console.log('generated surfaces registry check passed');
    return;
  }

  if (argv.json) {
    console.log(JSON.stringify({
      schemaVersion: registry.schemaVersion,
      root,
      surfaces: surfaces.map(({ resolvedOutputs, ...surface }) => surface)
    }, null, 2));
    return;
  }

  for (const surface of surfaces) {
    console.log(`${surface.id}`);
    console.log(`  owner: ${surface.owner}`);
    console.log(`  committed: ${surface.committed ? 'yes' : 'no'}`);
    console.log(`  validation: ${surface.validationMode}`);
    console.log(`  freshness: ${surface.freshnessExpectation}`);
    console.log(`  refresh: ${surface.refresh.command}`);
    console.log(`  audit: ${surface.audit?.command || 'none'}`);
    for (const output of surface.outputs) {
      console.log(`  output: ${output}`);
    }
  }
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
