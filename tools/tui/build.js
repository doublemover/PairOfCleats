#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { stableStringify } from '../../src/shared/stable-json.js';

const root = process.cwd();
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const smoke = hasFlag('--smoke');
const verifyOnly = hasFlag('--verify-manifest');

const targetsPath = path.join(root, 'tools', 'tui', 'targets.json');
const distDir = path.join(root, 'dist', 'tui');
const manifestPath = path.join(distDir, 'tui-artifacts-manifest.json');
const checksumPath = `${manifestPath}.sha256`;

const readTargets = async () => {
  const payload = JSON.parse(await fsPromises.readFile(targetsPath, 'utf8'));
  const targets = Array.isArray(payload?.targets) ? payload.targets : [];
  return targets
    .map((entry) => ({
      triple: String(entry?.triple || '').trim(),
      platform: String(entry?.platform || '').trim(),
      artifactName: String(entry?.artifactName || '').trim()
    }))
    .filter((entry) => entry.triple && entry.artifactName)
    .sort((a, b) => a.triple.localeCompare(b.triple));
};

const validateTargets = (targets) => {
  const seenTriples = new Set();
  const seenArtifacts = new Set();
  for (const target of targets) {
    if (seenTriples.has(target.triple)) {
      throw new Error(`duplicate triple in tools/tui/targets.json: ${target.triple}`);
    }
    if (seenArtifacts.has(target.artifactName)) {
      throw new Error(`duplicate artifactName in tools/tui/targets.json: ${target.artifactName}`);
    }
    seenTriples.add(target.triple);
    seenArtifacts.add(target.artifactName);
  }
};

const sha256File = (filePath) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

const run = async () => {
  const targets = await readTargets();
  validateTargets(targets);
  if (verifyOnly) {
    process.stderr.write('[tui-build] target manifest verification passed.\n');
    return;
  }

  await fsPromises.mkdir(distDir, { recursive: true });
  const artifacts = targets.map((target) => {
    const artifactPath = path.join(distDir, target.artifactName);
    const exists = fs.existsSync(artifactPath);
    return {
      triple: target.triple,
      platform: target.platform,
      artifactName: target.artifactName,
      artifactPath: path.relative(root, artifactPath).replace(/\\/g, '/'),
      exists,
      sha256: exists ? sha256File(artifactPath) : null
    };
  });

  const manifest = {
    schemaVersion: 1,
    tool: 'pairofcleats-tui',
    mode: smoke ? 'smoke' : 'plan',
    pathPolicy: 'repo-relative-posix',
    artifacts
  };

  const body = `${stableStringify(manifest)}\n`;
  await fsPromises.writeFile(manifestPath, body, 'utf8');
  const checksum = crypto.createHash('sha256').update(body).digest('hex');
  await fsPromises.writeFile(checksumPath, `${checksum}  ${path.basename(manifestPath)}\n`, 'utf8');

  process.stderr.write(`[tui-build] wrote ${path.relative(root, manifestPath)}\n`);
  process.stderr.write(`[tui-build] wrote ${path.relative(root, checksumPath)}\n`);
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
