#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checklistLineState, extractSection, hasUnchecked } from './usr-lock-test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const roadmapPath = path.join(repoRoot, 'TES_LAYN_ROADMAP.md');
const roadmapText = fs.readFileSync(roadmapPath, 'utf8');

const gateASection = extractSection(roadmapText, '### Gate A (B0 contracts/registries)', '### Gate B1-B7 (language batch gates)');
const gateB1Section = extractSection(roadmapText, '### Gate B1-B7 (language batch gates)', '### Gate B8 (cross-batch integration)');
const gateB8Section = extractSection(roadmapText, '### Gate B8 (cross-batch integration)', '### Gate C (test rollout)');
const gateCSection = extractSection(roadmapText, '### Gate C (test rollout)', '---');

const allPriorGatesState = checklistLineState(gateCSection, 'all prior gates pass.');
const rolloutAuthorizedState = checklistLineState(gateCSection, 'conformance rollout authorized.');

if (allPriorGatesState === 'checked') {
  assert.equal(hasUnchecked(gateASection), false, 'Gate C "all prior gates pass" cannot be checked while Gate A has unchecked items');
  assert.equal(hasUnchecked(gateB1Section), false, 'Gate C "all prior gates pass" cannot be checked while Gate B1-B7 has unchecked items');
  assert.equal(hasUnchecked(gateB8Section), false, 'Gate C "all prior gates pass" cannot be checked while Gate B8 has unchecked items');
}

if (rolloutAuthorizedState === 'checked') {
  assert.equal(allPriorGatesState, 'checked', 'Gate C "conformance rollout authorized" requires "all prior gates pass" to be checked first');
}

console.log('usr gate-c prerequisite lock validation checks passed');
