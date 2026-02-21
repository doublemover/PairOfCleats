#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const targetsPath = path.join(root, 'tools', 'tui', 'targets.json');
const payload = JSON.parse(await fs.readFile(targetsPath, 'utf8'));

const targets = Array.isArray(payload?.targets) ? payload.targets : [];
if (!targets.length) {
  console.error('target triple naming test failed: missing targets');
  process.exit(1);
}

const triples = new Set();
const artifacts = new Set();
for (const target of targets) {
  const triple = String(target?.triple || '');
  const artifactName = String(target?.artifactName || '');
  if (!triple || !artifactName) {
    console.error('target triple naming test failed: target entry missing triple/artifactName');
    process.exit(1);
  }
  if (triples.has(triple)) {
    console.error(`target triple naming test failed: duplicate triple ${triple}`);
    process.exit(1);
  }
  if (artifacts.has(artifactName)) {
    console.error(`target triple naming test failed: duplicate artifactName ${artifactName}`);
    process.exit(1);
  }
  if (!artifactName.includes(triple)) {
    console.error(`target triple naming test failed: artifactName does not include triple (${triple})`);
    process.exit(1);
  }
  triples.add(triple);
  artifacts.add(artifactName);
}

console.log('tui target triple artifact naming test passed');
