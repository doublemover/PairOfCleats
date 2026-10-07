#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'release', 'assemble-bundle.js');
const { dir: fixtureDir } = await prepareTestCacheDir('release-bundle-assembly');
const artifactRoot = path.join(fixtureDir, 'downloads');
const outDir = path.join(fixtureDir, 'bundle');
const metadataPath = path.join(fixtureDir, 'metadata.json');
const outsideArtifactRoot = path.resolve(root, '..', 'outside-release-artifacts');
const outsideOutDir = path.resolve(root, '..', `outside-release-bundle-output-${process.pid}`);

fs.mkdirSync(path.join(artifactRoot, 'release-node-packages', 'dist', 'vscode'), { recursive: true });
fs.mkdirSync(path.join(artifactRoot, 'release-node-packages', 'dist', 'vscode', 'nested'), { recursive: true });
fs.mkdirSync(path.join(artifactRoot, 'release-prepare'), { recursive: true });
fs.writeFileSync(path.join(artifactRoot, 'release-node-packages', 'dist', 'vscode', 'Zeta.txt'), 'zeta-upper');
fs.writeFileSync(path.join(artifactRoot, 'release-node-packages', 'dist', 'vscode', 'alpha.txt'), 'alpha-lower');
fs.writeFileSync(path.join(artifactRoot, 'release-node-packages', 'dist', 'vscode', 'nested', 'z.txt'), 'nested-z');
fs.writeFileSync(path.join(artifactRoot, 'release-node-packages', 'dist', 'vscode', 'pairofcleats.vsix'), 'vsix-bytes');
fs.writeFileSync(path.join(artifactRoot, 'release-prepare', 'notes.md'), 'notes');
fs.writeFileSync(metadataPath, `${JSON.stringify({
  releaseVersion: '0.3.0',
  releaseTag: 'v0.3.0',
  gitSha: 'abc123'
}, null, 2)}\n`);

const run = runNode(
  [scriptPath, '--artifact-root', artifactRoot, '--metadata', metadataPath, '--out', outDir],
  'release bundle assembly',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.equal(run.status, 0, run.stderr || run.stdout || 'expected release bundle assembly to succeed');
const payload = JSON.parse(run.stdout || '{}');
assert.equal(payload.ok, true, 'expected assembly payload ok=true');
const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'release-artifacts.json'), 'utf8'));
assert.equal(manifest.releaseTag, 'v0.3.0', 'expected release tag in bundle manifest');
assert.deepEqual(
  manifest.artifacts.map((artifact) => artifact.path),
  [
    path.relative(root, path.join(artifactRoot, 'release-node-packages', 'dist', 'vscode', 'Zeta.txt')).replace(/\\/g, '/'),
    path.relative(root, path.join(artifactRoot, 'release-node-packages', 'dist', 'vscode', 'alpha.txt')).replace(/\\/g, '/'),
    path.relative(root, path.join(artifactRoot, 'release-node-packages', 'dist', 'vscode', 'nested', 'z.txt')).replace(/\\/g, '/'),
    path.relative(root, path.join(artifactRoot, 'release-node-packages', 'dist', 'vscode', 'pairofcleats.vsix')).replace(/\\/g, '/'),
    path.relative(root, path.join(artifactRoot, 'release-prepare', 'notes.md')).replace(/\\/g, '/')
  ],
  'expected deterministic binary artifact order in bundle manifest'
);
assert.equal(fs.existsSync(path.join(outDir, 'release-checksums.txt')), true, 'expected checksums output');

const outsideRootRun = runNode(
  [scriptPath, '--artifact-root', outsideArtifactRoot, '--metadata', metadataPath, '--out', path.join(fixtureDir, 'outside-bundle')],
  'release bundle outside artifact root',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(outsideRootRun.status, 0, 'expected outside artifact root to fail');
assert.match(
  outsideRootRun.stderr,
  /artifact root must stay within repo root/,
  'expected outside artifact root failure to explain repo-root boundary'
);

const outsideOutRun = runNode(
  [scriptPath, '--artifact-root', artifactRoot, '--metadata', metadataPath, '--out', outsideOutDir],
  'release bundle outside output directory',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(outsideOutRun.status, 0, 'expected outside output directory to fail');
assert.match(
  outsideOutRun.stderr,
  /output directory must stay within repo root/,
  'expected outside output failure to explain repo-root boundary'
);
assert.equal(
  fs.existsSync(outsideOutDir),
  false,
  'expected release bundle command not to create an outside output directory'
);

console.log('release bundle assembly test passed');
