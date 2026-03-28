#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildImpactAnalysis } from '../../../src/graph/impact.js';

const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'graph',
  'impact',
  name
), 'utf8'));

const cases = [
  {
    name: 'downstream analysis reports impacted chunks with witness paths',
    run() {
      const impact = buildImpactAnalysis({
        seed: { type: 'chunk', chunkUid: 'chunk-a' },
        graphRelations: loadFixture('basic.json'),
        direction: 'downstream',
        depth: 1,
        caps: { maxWorkUnits: 100 },
        indexCompatKey: 'compat-impact-basic'
      });

      const impacted = impact.impacted.map((entry) => entry.ref?.chunkUid).filter(Boolean);
      assert.ok(impacted.includes('chunk-b'));
      const entry = impact.impacted.find((item) => item.ref?.chunkUid === 'chunk-b');
      assert.ok((entry?.witnessPath?.nodes?.length || 0) >= 2);
    }
  },
  {
    name: 'upstream analysis traces reverse dependencies',
    run() {
      const impact = buildImpactAnalysis({
        seed: { type: 'chunk', chunkUid: 'chunk-b' },
        graphRelations: loadFixture('basic.json'),
        direction: 'upstream',
        depth: 1,
        caps: { maxWorkUnits: 100 },
        indexCompatKey: 'compat-impact-upstream'
      });

      const impacted = impact.impacted.map((entry) => entry.ref?.chunkUid).filter(Boolean);
      assert.ok(impacted.includes('chunk-a'));
    }
  },
  {
    name: 'changed file lists synthesize file seeds and reach impacted files',
    run() {
      const impact = buildImpactAnalysis({
        changed: ['src/changed.js'],
        graphRelations: loadFixture('changed.json'),
        direction: 'downstream',
        depth: 1,
        caps: { maxWorkUnits: 100 },
        indexCompatKey: 'compat-impact-changed'
      });

      assert.equal(impact.seed?.type, 'file');
      assert.equal(impact.seed?.path, 'src/changed.js');
      const impacted = impact.impacted.map((entry) => entry.ref?.path).filter(Boolean);
      assert.ok(impacted.includes('src/target.js'));
    }
  },
  {
    name: 'fanout caps emit truncation records',
    run() {
      const impact = buildImpactAnalysis({
        seed: { type: 'chunk', chunkUid: 'seed' },
        graphRelations: loadFixture('caps.json'),
        direction: 'downstream',
        depth: 1,
        caps: { maxFanoutPerNode: 2, maxWorkUnits: 100 },
        indexCompatKey: 'compat-impact-caps'
      });

      const truncation = impact.truncation || [];
      assert.ok(truncation.some((record) => record.cap === 'maxFanoutPerNode'));
    }
  },
  {
    name: 'output remains deterministic across identical runs',
    run() {
      const buildOnce = () => buildImpactAnalysis({
        seed: { type: 'chunk', chunkUid: 'chunk-a' },
        graphRelations: loadFixture('basic.json'),
        direction: 'downstream',
        depth: 1,
        caps: { maxWorkUnits: 100 },
        indexCompatKey: 'compat-impact-determinism',
        now: () => '2026-02-01T00:00:00.000Z'
      });

      const stripStats = (value) => {
        const cloned = JSON.parse(JSON.stringify(value));
        delete cloned.stats;
        return cloned;
      };

      assert.equal(JSON.stringify(stripStats(buildOnce())), JSON.stringify(stripStats(buildOnce())));
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('impact analysis contract matrix test passed');
