#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScoreBreakdownHits } from './score-breakdown-fixture.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const expectedPath = path.join(__dirname, 'golden', 'score-breakdown-snapshots.json');
const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

const { codeHit, proseHit } = await createScoreBreakdownHits();

const snapshot = {
  code: codeHit?.scoreBreakdown || null,
  prose: proseHit?.scoreBreakdown || null
};

assert.deepEqual(snapshot, expected, 'score breakdown snapshot drift detected');

console.log('score breakdown snapshots test passed');
