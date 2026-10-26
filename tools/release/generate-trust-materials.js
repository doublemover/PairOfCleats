#!/usr/bin/env node
import fs from 'node:fs';
import { assertReleaseSource, bindSbomSource, releaseSourceErrors } from './source-revision.js';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { writeJsonFileSyncResolved } from '../../src/shared/json-file.js';
import { resolveRepoRootArg } from '../shared/dict-utils.js';
import { resolveRepoContainedOutputPath, resolveRepoContainedPath } from './file-walk.js';
import { toIso } from './metadata-support.js';
import { withOperationalTool } from '../tooling/operational-execution.js';

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
const bundleDirResolution = resolveRepoContainedPath(
  root,
  String(argv['bundle-dir'] || 'dist/release/bundle'),
  'bundle directory'
);
const metadataPathResolution = resolveRepoContainedPath(
  root,
  String(argv.metadata || 'dist/release/downloads/release-prepare/metadata.json'),
  'metadata path'
);
const outDirResolution = resolveRepoContainedOutputPath(
  root,
  String(argv['out-dir'] || 'dist/release/trust'),
  'output directory'
);
const nodeSbomInputResolution = resolveRepoContainedPath(
  root,
  String(argv['node-sbom-input'] || '').trim(),
  'node SBOM input'
);
const cargoSbomInputResolution = resolveRepoContainedPath(
  root,
  String(argv['cargo-sbom-input'] || '').trim(),
  'cargo SBOM input'
);
const cargoManifestPathResolution = resolveRepoContainedPath(
  root,
  String(argv['cargo-manifest-path'] || 'crates/pairofcleats-tui/Cargo.toml'),
  'cargo manifest path'
);
const bundleDir = bundleDirResolution.path;
const metadataPath = metadataPathResolution.path;
const outDir = outDirResolution.path;
const nodeSbomInput = nodeSbomInputResolution.path;
const cargoSbomInput = cargoSbomInputResolution.path;
const cargoManifestPath = cargoManifestPathResolution.path;
const pathResolutions = [
  bundleDirResolution,
  metadataPathResolution,
  outDirResolution,
  nodeSbomInputResolution,
  cargoSbomInputResolution,
  cargoManifestPathResolution
];

const toPosixRelative = (filePath) => path.relative(root, filePath).replace(/\\/g, '/');

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const writeJson = (filePath, payload) => {
  writeJsonFileSyncResolved(filePath, payload, { trailingNewline: true });
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

const runNodeSbom = async (outputPath) => {
  const result = await withOperationalTool('npm-sbom', { repoRoot: root }, tool => tool.run([
    'sbom',
    '--package-lock-only',
    '--sbom-format',
    'cyclonedx',
    '--sbom-type',
    'application'
  ], {
    cwd: root,
    maxOutputBytes: 32 * 1024 * 1024
  }));
  if (result.exitCode !== 0) {
    throw new Error(`release trust materials: npm sbom failed\n${String(result.stderr || result.stdout || '').trim()}`);
  }
  const bom = JSON.parse(result.stdout);
  if (bom?.bomFormat !== 'CycloneDX' || typeof bom.specVersion !== 'string') throw new Error('release trust materials: npm sbom returned no CycloneDX document.');
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, result.stdout);
};

const runCargoSbom = async (outputPath) => {
  const manifestDir = path.dirname(cargoManifestPath);
  const result = await withOperationalTool('cargo-cyclonedx', { repoRoot: root }, tool => tool.run([
    '--manifest-path',
    cargoManifestPath,
    '--format',
    'json',
    '--override-filename',
    'sbom-tui'
  ], {
    cwd: manifestDir,
    maxOutputBytes: 1024 * 1024
  }));
  if (result.exitCode !== 0) {
    throw new Error(`release trust materials: cargo cyclonedx failed\n${String(result.stderr || result.stdout || '').trim()}`);
  }
  const generatedPath = path.join(manifestDir, 'sbom-tui.cdx.json');
  if (!fs.existsSync(generatedPath)) {
    throw new Error(`release trust materials: cargo cyclonedx did not produce ${toPosixRelative(generatedPath)}`);
  }
  const bom = readJson(generatedPath);
  if (bom?.bomFormat !== 'CycloneDX' || typeof bom.specVersion !== 'string') throw new Error('release trust materials: cargo-cyclonedx returned no CycloneDX document.');
  ensureDir(path.dirname(outputPath));
  fs.copyFileSync(generatedPath, outputPath);
};

const run = async () => {
  for (const resolution of pathResolutions) {
    if (!resolution.ok) {
      throw new Error(`release trust materials: ${resolution.error}`);
    }
  }
  ensureDir(outDir);
  const metadata = fs.existsSync(metadataPath) ? readJson(metadataPath) : {};
  const { bundleManifest, manifestPath, checksumsPath, checksumLines } = loadBundleArtifacts();
  verifyChecksumLines({
    artifacts: Array.isArray(bundleManifest.artifacts) ? bundleManifest.artifacts : [],
    checksumLines
  });

  const observedSourceCommit = assertReleaseSource(root, metadata.gitSha || bundleManifest.gitSha);
  const sourceErrors = [...releaseSourceErrors(bundleManifest.gitSha, observedSourceCommit),
    ...releaseSourceErrors(bundleManifest.observedSourceCommit, observedSourceCommit)];
  if (metadata.gitSha) sourceErrors.push(...releaseSourceErrors(metadata.gitSha, observedSourceCommit));
  if (sourceErrors.length) throw new Error('release trust materials: ' + sourceErrors.join('; '));
  const nodeSbomPath = path.join(outDir, 'node-root.cyclonedx.json');
  const cargoSbomPath = path.join(outDir, 'tui.cyclonedx.json');
  if (nodeSbomInput) {
    writeSbomFromInput({ inputPath: nodeSbomInput, outputPath: nodeSbomPath });
  } else {
    await runNodeSbom(nodeSbomPath);
  }
  if (cargoSbomInput) {
    writeSbomFromInput({ inputPath: cargoSbomInput, outputPath: cargoSbomPath });
  } else {
    await runCargoSbom(cargoSbomPath);
  }

  assertReleaseSource(root, observedSourceCommit);
  for (const file of [nodeSbomPath, cargoSbomPath]) writeJson(file, bindSbomSource(readJson(file), observedSourceCommit));

  const checksumBundle = {
    schemaVersion: 1,
    generatedAt: toIso(),
    releaseVersion: metadata.releaseVersion || bundleManifest.releaseVersion || null,
    releaseTag: metadata.releaseTag || bundleManifest.releaseTag || null,
    sourceCommit: observedSourceCommit,
    observedSourceCommit,
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
    sha: observedSourceCommit,
    observedSourceCommit,
    releaseTag: metadata.releaseTag || bundleManifest.releaseTag || null,
    subjects: [
      toPosixRelative(manifestPath),
      toPosixRelative(checksumsPath),
      toPosixRelative(nodeSbomPath),
      toPosixRelative(cargoSbomPath)
    ]
  };
  const trustManifest = {
    observedSourceCommit,
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
