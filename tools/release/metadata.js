#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { resolveRepoRootArg } from '../shared/dict-utils.js';
import { writeJsonFileResolved } from '../../src/shared/json-file.js';
import { writeTextIfChanged } from '../shared/generated-report.js';
import { requireRepoContainedOutputPath } from './file-walk.js';
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
    'git-sha': { type: 'string', default: '' },
    out: { type: 'string', default: '' },
    'notes-out': { type: 'string', default: '' }
  }
}).parse();

const root = resolveRepoRootArg(null, process.cwd());

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
    gitSha: String(argv['git-sha'] || process.env.RELEASE_GIT_SHA || process.env.GITHUB_SHA || '').trim() || null,
    publishEligible: Boolean(releaseTag),
    packageVersionSource: path.relative(root, packagePath).replace(/\\/g, '/'),
    changelogPath: path.relative(root, changelogPath).replace(/\\/g, '/'),
    changelogSection: section,
    shippedSurfaces: surfaceVersions
  };

  const outPath = String(argv.out || '').trim()
    ? requireRepoContainedOutputPath(root, String(argv.out).trim(), 'output path')
    : '';
  const notesOutPath = String(argv['notes-out'] || '').trim()
    ? requireRepoContainedOutputPath(root, String(argv['notes-out']).trim(), 'notes output path')
    : '';

  if (outPath) {
    await writeJsonFileResolved(outPath, payload, { trailingNewline: true });
  }
  if (notesOutPath) {
    await writeTextIfChanged(notesOutPath, `${section}\n`, { encoding: 'utf8' });
  }

  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
