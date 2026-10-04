#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { createFanoutPrefixFixture, projectFanoutResult } from './helpers/fanout-prefix-fixture.js';

const golden = JSON.parse(await fs.readFile(new URL('../fixtures/graph/fanout-prefix.json', import.meta.url), 'utf8'));
const capped = createFanoutPrefixFixture();
const output = buildGraphNeighborhood(capped.request);
assert.deepEqual(projectFanoutResult(output), golden, 'unchanged baseline output includes discarded-symbol notices and full fanout counts');
assert.equal(capped.getEvidenceLookups(), 3, 'only retained call candidates construct their evidence');
assert.equal(output.truncation.find((entry) => entry.cap === 'maxFanoutPerNode').observed, 78);
assert.equal(output.truncation.find((entry) => entry.cap === 'maxCandidates').observed, 4);
assert.equal(output.stats.capsTriggered.maxCandidates, 2, 'notices from discarded symbol candidates remain visible');

for (const direction of ['out', 'in', 'both']) {
  for (const cap of [0, 1, 3, null]) {
    const csr = createFanoutPrefixFixture({ direction, cap });
    const legacy = createFanoutPrefixFixture({ direction, cap, csr: false });
    const actual = buildGraphNeighborhood(csr.request);
    const expected = buildGraphNeighborhood(legacy.request);
    assert.deepEqual(projectFanoutResult(actual), projectFanoutResult(expected));
    const callEdges = actual.edges.filter((edge) => edge.graph === 'callGraph').length;
    assert.equal(csr.getEvidenceLookups(), callEdges);
    assert.equal(legacy.getEvidenceLookups(), callEdges);
    if (cap != null) assert.ok(actual.edges.length <= cap);
  }
}
const filtered = createFanoutPrefixFixture();
filtered.request.edgeFilters = { graphs: ['usageGraph', 'symbolEdges'] };
const filteredResult = buildGraphNeighborhood(filtered.request);
assert.ok(filteredResult.edges.every((edge) => edge.graph === 'usageGraph'));
assert.equal(filteredResult.truncation.find((entry) => entry.cap === 'maxFanoutPerNode').observed, 10);
assert.equal(filteredResult.stats.capsTriggered.maxCandidates, 2);
assert.equal(filtered.getEvidenceLookups(), 0);
console.log('Graph fanout prefix admission passed: baseline output/counts,64 to3 evidence lookups, CSR/legacy directions, zero/uncapped and discarded-symbol notices');
