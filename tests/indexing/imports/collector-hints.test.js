#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-resolution-collector-hints');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
const importerRel = 'flake.nix';
const importerAbs = path.join(tempRoot, importerRel);
await fs.writeFile(importerAbs, 'import ./missing-module.nix\n', 'utf8');

const entries = [{ abs: importerAbs, rel: importerRel }];
const importsByFile = {
  [importerRel]: ['./missing-module.nix']
};
const fileRelations = new Map([[importerRel, { imports: ['./missing-module.nix'] }]]);

const baseline = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: new Map(fileRelations),
  enableGraph: true
});
assert.equal(baseline.unresolvedSamples?.length, 1, 'expected baseline unresolved sample');
assert.equal(
  baseline.unresolvedSamples[0]?.reasonCode,
  'IMP_U_MISSING_FILE_RELATIVE',
  'expected baseline unresolved reason without collector hints'
);

const hinted = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  importHintsByFile: {
    [importerRel]: {
      './missing-module.nix': {
        reasonCode: 'IMP_U_RESOLVER_GAP',
        confidence: 0.91,
        detail: 'nix-dynamic-import'
      }
    }
  },
  fileRelations: new Map(fileRelations),
  enableGraph: true
});
assert.equal(hinted.unresolvedSamples?.length, 1, 'expected hinted unresolved sample');
assert.equal(hinted.unresolvedSamples[0]?.reasonCode, 'IMP_U_RESOLVER_GAP');
assert.equal(hinted.unresolvedSamples[0]?.failureCause, 'resolver_gap');
assert.equal(hinted.unresolvedSamples[0]?.disposition, 'suppress_gate');
assert.equal(hinted.unresolvedSamples[0]?.collectorHint?.reasonCode, 'IMP_U_RESOLVER_GAP');

console.log('import resolution collector hint test passed');
