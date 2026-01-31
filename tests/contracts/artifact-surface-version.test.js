#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';

const root = process.cwd();
const docPath = path.join(root, 'docs', 'contracts', 'public-artifact-surface.md');
const text = await fs.readFile(docPath, 'utf8');

const escapedVersion = ARTIFACT_SURFACE_VERSION.replace(/\./g, '\\.')
const versionRegex = new RegExp(`\\b${escapedVersion}\\b`);
assert.ok(versionRegex.test(text), 'public artifact surface doc should include current artifact surface version');

const headerLine = text.split('\n').find((line) => line.startsWith('# Public Artifact Surface')) || '';
assert.ok(
  headerLine.includes(ARTIFACT_SURFACE_VERSION),
  'doc header should include the current artifact surface version'
);

const bulletMatch = text.match(/artifactSurfaceVersion`:\s*\*\*(\d+\.\d+\.\d+)\*\*/);
assert.ok(bulletMatch, 'expected artifactSurfaceVersion bullet to be present');
assert.equal(bulletMatch[1], ARTIFACT_SURFACE_VERSION, 'artifactSurfaceVersion bullet should match current version');

console.log('artifact surface version doc test passed');
