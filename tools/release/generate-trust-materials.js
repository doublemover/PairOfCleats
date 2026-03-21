#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCli } from '../../src/shared/cli.js';
import { resolveRepoRootArg } from '../shared/dict-utils.js';
import { toIso } from './metadata-support.js';

const argv = createCli({
  scriptName: 'pairofcleats release generate-trust-materials',
  options: {
    'bundle-dir': { type: 'string', default: 'dist/release/bundle' },
    metadata: { type: 'string', default: 'dist/release/downloads/release-prepare/metadata.json' },
    'out-dir': { type: 'string', default: 'dist/release/trust' },
    'node-sbom-input': { type: 'string', default: '' },
    'cargo-sbom-input': { type: 'string', default: '' },
    'cargo-manifest-path': { type: 'string', default: 'crates/pairofcleats-tui/Cargo.toml' }
  }
}).parse();

const root = resolveRepoRootArg(null, process.cwd());
const bundleDir = path.resolve(root, String(argv['bundle-dir'] || 'dist/release/bundle'));
const metadataPath = path.resolve(root, String(argv.metadata || 'dist/release/downloads/release-prepare/metadata.json'));
const outDir = path.resolve(root, String(argv['out-dir'] || 'dist/release/trust'));
const nodeSbomInput = String(argv['node-sbom-input'] || '').trim()
  ? path.resolve(root, String(argv['node-sbom-input']).trim())
  : '';
const cargoSbomInput = String(argv['cargo-sbom-input'] || '').trim()
  ? path.resolve(root, String(argv['cargo-sbom-input']).trim())
  : '';
const cargoManifestPath = path.resolve(root, String(argv['cargo-manifest-path'] || 'crates/pairofcleats-tui/Cargo.toml'));

const toPosixRelative = (filePath) => path.relative(root, filePath).replace(/\\/g, '/');

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const writeJson = (filePath, payload) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
};

const loadBundleArtifacts = () => {
  const manifestPath = path.join(bundleDir, 'release-artifacts.json');
  const checksumsPath = path.join(bundleDir, 'release-checksums.txt');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`release trust materials: missing bundle manifest ${toPosixRelative(manifestPath)}`);
  }
  if (!fs.existsSync(checksumsPath)) {
    throw new Error(`release trust materials: missing checksum list ${toPosixRelative(checksumsPath)}`);
  }
  return {
    manifestPath,
    checksumsPath,
    bundleManifest: readJson(manifestPath),
    checksumLines: fs.readFileSync(checksumsPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  };
};

const verifyChecksumLines = ({ artifacts, checksumLines }) => {
  const expectedLines = artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.path}`)
    .sort((a, b) => a.localeCompare(b));
  const actualLines = [...checksumLines].sort((a, b) => a.localeCompare(b));
  if (expectedLines.length !== actualLines.length) {
    throw new Error('release trust materials: checksum line count does not match bundle artifact count.');
  }
  for (let i = 0; i < expectedLines.length; i += 1) {
    if (expectedLines[i] !== actualLines[i]) {
      throw new Error('release trust materials: checksum text and bundle manifest are out of sync.');
    }
  }
};

const writeSbomFromInput = ({ inputPath, outputPath }) => {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`release trust materials: missing SBOM input ${toPosixRelative(inputPath)}`);
  }
  ensureDir(path.dirname(outputPath));
  fs.copyFileSync(inputPath, outputPath);
};

const runNodeSbom = (outputPath) => {
  const result = spawnSync('npm', [
    'sbom',
    '--package-lock-only',
    '--sbom-format',
    'cyclonedx',
    '--sbom-type',
    'application'
  ], {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`release trust materials: npm sbom failed\n${String(result.stderr || result.stdout || '').trim()}`);
  }
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, result.stdout);
};

const runCargoSbom = (outputPath) => {
  const probe = spawnSync('cargo', ['cyclonedx', '--help'], {
    cwd: root,
    encoding: 'utf8'
  });
  if (probe.status !== 0) {
    throw new Error('release trust materials: cargo cyclonedx is required but not installed.');
  }
  const manifestDir = path.dirname(cargoManifestPath);
  const result = spawnSync('cargo', [
    'cyclonedx',
    '--manifest-path',
    cargoManifestPath,
    '--format',
    'json',
    '--output-prefix',
    'sbom-tui',
    '--output-cdx'
  ], {
    cwd: manifestDir,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`release trust materials: cargo cyclonedx failed\n${String(result.stderr || result.stdout || '').trim()}`);
  }
  const generatedPath = path.join(manifestDir, 'sbom-tui.cdx.json');
  if (!fs.existsSync(generatedPath)) {
    throw new Error(`release trust materials: cargo cyclonedx did not produce ${toPosixRelative(generatedPath)}`);
  }
  ensureDir(path.dirname(outputPath));
  fs.copyFileSync(generatedPath, outputPath);
};

const run = async () => {
  ensureDir(outDir);
  const metadata = fs.existsSync(metadataPath) ? readJson(metadataPath) : {};
  const { bundleManifest, manifestPath, checksumsPath, checksumLines } = loadBundleArtifacts();
  verifyChecksumLines({
    artifacts: Array.isArray(bundleManifest.artifacts) ? bundleManifest.artifacts : [],
    checksumLines
  });

  const nodeSbomPath = path.join(outDir, 'node-root.cyclonedx.json');
  const cargoSbomPath = path.join(outDir, 'tui.cyclonedx.json');
  if (nodeSbomInput) {
    writeSbomFromInput({ inputPath: nodeSbomInput, outputPath: nodeSbomPath });
  } else {
    runNodeSbom(nodeSbomPath);
  }
  if (cargoSbomInput) {
    writeSbomFromInput({ inputPath: cargoSbomInput, outputPath: cargoSbomPath });
  } else {
    runCargoSbom(cargoSbomPath);
  }

  const checksumBundle = {
    schemaVersion: 1,
    generatedAt: toIso(),
    releaseVersion: metadata.releaseVersion || bundleManifest.releaseVersion || null,
    releaseTag: metadata.releaseTag || bundleManifest.releaseTag || null,
    sourceCommit: metadata.gitSha || bundleManifest.gitSha || process.env.GITHUB_SHA || null,
    artifacts: bundleManifest.artifacts
  };
  const provenanceSummary = {
    schemaVersion: 1,
    generatedAt: toIso(),
    attestationProvider: 'github-actions-attest-build-provenance',
    workflow: String(process.env.GITHUB_WORKFLOW || '').trim() || null,
    runId: String(process.env.GITHUB_RUN_ID || '').trim() || null,
    runAttempt: String(process.env.GITHUB_RUN_ATTEMPT || '').trim() || null,
    repository: String(process.env.GITHUB_REPOSITORY || '').trim() || null,
    ref: String(process.env.GITHUB_REF || '').trim() || null,
    sha: metadata.gitSha || bundleManifest.gitSha || String(process.env.GITHUB_SHA || '').trim() || null,
    releaseTag: metadata.releaseTag || bundleManifest.releaseTag || null,
    subjects: [
      toPosixRelative(manifestPath),
      toPosixRelative(checksumsPath),
      toPosixRelative(nodeSbomPath),
      toPosixRelative(cargoSbomPath)
    ]
  };
  const trustManifest = {
    schemaVersion: 1,
    generatedAt: toIso(),
    releaseVersion: checksumBundle.releaseVersion,
    releaseTag: checksumBundle.releaseTag,
    checksumBundlePath: 'release-checksum-bundle.json',
    provenanceSummaryPath: 'provenance-summary.json',
    sboms: [
      { id: 'node-root', path: 'node-root.cyclonedx.json', format: 'cyclonedx-json' },
      { id: 'tui', path: 'tui.cyclonedx.json', format: 'cyclonedx-json' }
    ]
  };

  writeJson(path.join(outDir, 'release-checksum-bundle.json'), checksumBundle);
  writeJson(path.join(outDir, 'provenance-summary.json'), provenanceSummary);
  writeJson(path.join(outDir, 'trust-manifest.json'), trustManifest);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    outDir: toPosixRelative(outDir),
    files: [
      'release-checksum-bundle.json',
      'provenance-summary.json',
      'trust-manifest.json',
      'node-root.cyclonedx.json',
      'tui.cyclonedx.json'
    ]
  })}\n`);
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
