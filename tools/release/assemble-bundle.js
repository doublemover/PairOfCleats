#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { resolveRepoRootArg } from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'pairofcleats release assemble-bundle',
  options: {
    'artifact-root': { type: 'string', default: 'dist/release/downloads' },
    out: { type: 'string', default: 'dist/release/bundle' },
    metadata: { type: 'string', default: '' }
  }
}).parse();

const root = resolveRepoRootArg(null, process.cwd());
const artifactRoot = path.resolve(root, String(argv['artifact-root'] || 'dist/release/downloads'));
const outDir = path.resolve(root, String(argv.out || 'dist/release/bundle'));
const metadataPath = String(argv.metadata || '').trim()
  ? path.resolve(root, String(argv.metadata).trim())
  : '';

const sha256File = (filePath) => crypto
  .createHash('sha256')
  .update(fs.readFileSync(filePath))
  .digest('hex');

const toPosixRelative = (baseDir, filePath) => path.relative(baseDir, filePath).replace(/\\/g, '/');

const collectFiles = (dirPath) => {
  if (!fs.existsSync(dirPath)) return [];
  const files = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(resolved);
        continue;
      }
      files.push(resolved);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
};

const run = async () => {
  if (!fs.existsSync(artifactRoot)) {
    throw new Error(`release bundle: artifact root not found: ${toPosixRelative(root, artifactRoot)}`);
  }
  const releaseFiles = collectFiles(artifactRoot);
  if (releaseFiles.length === 0) {
    throw new Error(`release bundle: no files found under ${toPosixRelative(root, artifactRoot)}`);
  }
  fs.mkdirSync(outDir, { recursive: true });

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
  fs.writeFileSync(manifestPath, `${JSON.stringify(bundleManifest, null, 2)}\n`);
  fs.writeFileSync(
    checksumsPath,
    `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join('\n')}\n`
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
