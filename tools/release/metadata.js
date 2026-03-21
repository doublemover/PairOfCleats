#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { resolveRepoRootArg } from '../shared/dict-utils.js';
import { loadShippedSurfaces } from './surfaces.js';
import {
  extractChangelogSection,
  readPackageVersion,
  resolveVersionSource,
  toIso,
  validateReleaseTag
} from './metadata-support.js';

const argv = createCli({
  scriptName: 'pairofcleats release metadata',
  options: {
    tag: { type: 'string', default: '' },
    out: { type: 'string', default: '' },
    'notes-out': { type: 'string', default: '' }
  }
}).parse();

const root = resolveRepoRootArg(null, process.cwd());

const ensureParentDir = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const run = async () => {
  const { version, packagePath, packageName } = readPackageVersion(root);
  const { changelogPath, section } = extractChangelogSection(root, version);
  const releaseTag = validateReleaseTag({
    tag: argv.tag || process.env.GITHUB_REF_NAME || process.env.GITHUB_REF || '',
    version
  });
  const registry = loadShippedSurfaces(root);
  const surfaceVersions = registry.surfaces.map((surface) => {
    const resolved = resolveVersionSource(root, surface.versionSource);
    return {
      id: surface.id,
      name: surface.name,
      versionSource: surface.versionSource,
      version: resolved.version || null,
      path: path.relative(root, resolved.path || '').replace(/\\/g, '/')
    };
  });
  const payload = {
    schemaVersion: 1,
    generatedAt: toIso(),
    root: root.replace(/\\/g, '/'),
    packageName,
    releaseVersion: version,
    releaseTag: releaseTag || null,
    gitRef: String(process.env.GITHUB_REF || '').trim() || null,
    gitRefName: String(process.env.GITHUB_REF_NAME || '').trim() || null,
    gitSha: String(process.env.GITHUB_SHA || '').trim() || null,
    publishEligible: Boolean(releaseTag),
    packageVersionSource: path.relative(root, packagePath).replace(/\\/g, '/'),
    changelogPath: path.relative(root, changelogPath).replace(/\\/g, '/'),
    changelogSection: section,
    shippedSurfaces: surfaceVersions
  };

  const outPath = String(argv.out || '').trim()
    ? path.resolve(root, String(argv.out).trim())
    : '';
  const notesOutPath = String(argv['notes-out'] || '').trim()
    ? path.resolve(root, String(argv['notes-out']).trim())
    : '';

  if (outPath) {
    ensureParentDir(outPath);
    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  }
  if (notesOutPath) {
    ensureParentDir(notesOutPath);
    fs.writeFileSync(notesOutPath, `${section}\n`);
  }

  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
