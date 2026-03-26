#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLaneManifests } from '../../tests/runner/lane-manifests.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const main = async () => {
  const { manifests } = await generateLaneManifests({ root: ROOT });
  for (const [lane, manifest] of manifests.entries()) {
    process.stdout.write(
      `${lane}\t${manifest.tests.length}\t${path.relative(ROOT, manifest.manifestPath).replace(/\\/g, '/')}\n`
    );
  }
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
