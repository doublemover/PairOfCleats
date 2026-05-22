#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { writeJsonFileResolved } from '../../src/shared/json-file.js';
import { resolveRepoRootArg } from '../shared/dict-utils.js';
import { writeTextIfChanged } from '../shared/generated-report.js';
import {
  collectSortedFiles,
  resolveRepoContainedOutputPath,
  resolveRepoContainedPath,
  toPosixRelative
} from './file-walk.js';

const argv = createCli({
  scriptName: 'pairofcleats release assemble-bundle',
  options: {
    'artifact-root': { type: 'string', default: 'dist/release/downloads' },
    out: { type: 'string', default: 'dist/release/bundle' },
    metadata: { type: 'string', default: '' }
  }
}).parse();

const root = resolveRepoRootArg(null, process.cwd());
const outDirResolution = resolveRepoContainedOutputPath(root, String(argv.out || 'dist/release/bundle'), 'output directory');
const outDir = outDirResolution.path;
const artifactRootInput = String(argv['artifact-root'] || 'dist/release/downloads');
const artifactRootResolution = resolveRepoContainedPath(root, artifactRootInput, 'artifact root');
const metadataInput = String(argv.metadata || '').trim();
const metadataResolution = metadataInput
  ? resolveRepoContainedPath(root, metadataInput, 'metadata path')
  : { ok: true, path: '', relative: '' };
const artifactRoot = artifactRootResolution.path;
const metadataPath = metadataResolution.path;

const sha256File = (filePath) => crypto
  .createHash('sha256')
  .update(fs.readFileSync(filePath))
  .digest('hex');

const run = async () => {
  if (!outDirResolution.ok) {
    throw new Error(`release bundle: ${outDirResolution.error}`);
  }
  if (!artifactRootResolution.ok) {
    throw new Error(`release bundle: ${artifactRootResolution.error}`);
  }
  if (!metadataResolution.ok) {
    throw new Error(`release bundle: ${metadataResolution.error}`);
  }
  if (!fs.existsSync(artifactRoot)) {
    throw new Error(`release bundle: artifact root not found: ${toPosixRelative(root, artifactRoot)}`);
  }
  const releaseFiles = collectSortedFiles(artifactRoot);
  if (releaseFiles.length === 0) {
    throw new Error(`release bundle: no files found under ${toPosixRelative(root, artifactRoot)}`);
  }
  const metadata = metadataPath && fs.existsSync(metadataPath)
    ? JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    : null;

  const artifacts = releaseFiles.map((filePath) => {
    const stat = fs.statSync(filePath);
    return {
      path: toPosixRelative(root, filePath),
      sizeBytes: stat.size,
      sha256: sha256File(filePath)
    };
  });

  const bundleManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: root.replace(/\\/g, '/'),
    artifactRoot: toPosixRelative(root, artifactRoot),
    releaseTag: metadata?.releaseTag || null,
    releaseVersion: metadata?.releaseVersion || null,
    gitSha: metadata?.gitSha || null,
    metadataPath: metadataPath && fs.existsSync(metadataPath)
      ? toPosixRelative(root, metadataPath)
      : null,
    artifacts
  };

  const manifestPath = path.join(outDir, 'release-artifacts.json');
  const checksumsPath = path.join(outDir, 'release-checksums.txt');
  await writeJsonFileResolved(manifestPath, bundleManifest, { trailingNewline: true });
  await writeTextIfChanged(
    checksumsPath,
    `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join('\n')}\n`,
    { encoding: 'utf8' }
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    artifactCount: artifacts.length,
    manifest: toPosixRelative(root, manifestPath),
    checksums: toPosixRelative(root, checksumsPath)
  })}\n`);
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
