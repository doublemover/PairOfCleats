#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'release', 'generate-trust-materials.js');
const { dir: fixtureDir } = await prepareTestCacheDir('release-trust-materials');
const bundleDir = path.join(fixtureDir, 'bundle');
const outDir = path.join(fixtureDir, 'trust');
const metadataPath = path.join(fixtureDir, 'metadata.json');
const nodeSbomInput = path.join(fixtureDir, 'node-input.cyclonedx.json');
const cargoSbomInput = path.join(fixtureDir, 'cargo-input.cyclonedx.json');

fs.mkdirSync(bundleDir, { recursive: true });
const artifacts = [
  { path: 'dist/vscode/pairofcleats.vsix', sizeBytes: 10, sha256: 'a'.repeat(64) },
  { path: 'dist/sublime/pairofcleats.sublime-package', sizeBytes: 20, sha256: 'b'.repeat(64) }
];
fs.writeFileSync(path.join(bundleDir, 'release-artifacts.json'), `${JSON.stringify({
  schemaVersion: 1,
  releaseVersion: '0.3.0',
  releaseTag: 'v0.3.0',
  gitSha: 'abc123',
  artifacts
}, null, 2)}\n`);
fs.writeFileSync(
  path.join(bundleDir, 'release-checksums.txt'),
  `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join('\n')}\n`
);
fs.writeFileSync(metadataPath, `${JSON.stringify({
  releaseVersion: '0.3.0',
  releaseTag: 'v0.3.0',
  gitSha: 'abc123'
}, null, 2)}\n`);
fs.writeFileSync(nodeSbomInput, '{"bomFormat":"CycloneDX","metadata":{"component":{"name":"node-root"}}}\n');
fs.writeFileSync(cargoSbomInput, '{"bomFormat":"CycloneDX","metadata":{"component":{"name":"tui"}}}\n');

const run = runNode(
  [
    scriptPath,
    '--bundle-dir',
    bundleDir,
    '--metadata',
    metadataPath,
    '--out-dir',
    outDir,
    '--node-sbom-input',
    nodeSbomInput,
    '--cargo-sbom-input',
    cargoSbomInput
  ],
  'release trust materials',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.equal(run.status, 0, run.stderr || run.stdout || 'expected trust materials generation to succeed');
const payload = JSON.parse(run.stdout || '{}');
assert.equal(payload.ok, true, 'expected ok=true payload');
const trustManifest = JSON.parse(fs.readFileSync(path.join(outDir, 'trust-manifest.json'), 'utf8'));
assert.equal(trustManifest.releaseTag, 'v0.3.0', 'expected release tag in trust manifest');
const provenanceSummary = JSON.parse(fs.readFileSync(path.join(outDir, 'provenance-summary.json'), 'utf8'));
assert.equal(provenanceSummary.attestationProvider, 'github-actions-attest-build-provenance', 'expected attestation provider summary');
const checksumBundle = JSON.parse(fs.readFileSync(path.join(outDir, 'release-checksum-bundle.json'), 'utf8'));
assert.equal(checksumBundle.artifacts.length, 2, 'expected artifacts copied into checksum bundle');
assert.equal(fs.existsSync(path.join(outDir, 'node-root.cyclonedx.json')), true, 'expected node sbom output');
assert.equal(fs.existsSync(path.join(outDir, 'tui.cyclonedx.json')), true, 'expected cargo sbom output');

console.log('release trust materials test passed');
