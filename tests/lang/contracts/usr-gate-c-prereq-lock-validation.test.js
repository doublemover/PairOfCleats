#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const roadmapPath = path.join(repoRoot, 'TES_LAYN_ROADMAP.md');
const roadmapText = fs.readFileSync(roadmapPath, 'utf8');

const extractSection = (startMarker, endMarker) => {
  const start = roadmapText.indexOf(startMarker);
  assert.notEqual(start, -1, `missing roadmap section start marker: ${startMarker}`);
  const end = roadmapText.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing roadmap section end marker: ${endMarker}`);
  return roadmapText.slice(start, end);
};

const gateASection = extractSection('### Gate A (B0 contracts/registries)', '### Gate B1-B7 (language batch gates)');
const gateB1Section = extractSection('### Gate B1-B7 (language batch gates)', '### Gate B8 (cross-batch integration)');
const gateB8Section = extractSection('### Gate B8 (cross-batch integration)', '### Gate C (test rollout)');
const gateCSection = extractSection('### Gate C (test rollout)', '---');

const checklistLineState = (section, itemLabel) => {
  const escaped = itemLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const checked = new RegExp(`^- \\[x\\] ${escaped}$`, 'm').test(section);
  const unchecked = new RegExp(`^- \\[ \\] ${escaped}$`, 'm').test(section);
  assert.equal(checked || unchecked, true, `missing checklist line: ${itemLabel}`);
  return checked ? 'checked' : 'unchecked';
};

const allPriorGatesState = checklistLineState(gateCSection, 'all prior gates pass.');
const rolloutAuthorizedState = checklistLineState(gateCSection, 'conformance rollout authorized.');

const hasUnchecked = (section) => /- \[ \] /.test(section);

if (allPriorGatesState === 'checked') {
  assert.equal(hasUnchecked(gateASection), false, 'Gate C "all prior gates pass" cannot be checked while Gate A has unchecked items');
  assert.equal(hasUnchecked(gateB1Section), false, 'Gate C "all prior gates pass" cannot be checked while Gate B1-B7 has unchecked items');
  assert.equal(hasUnchecked(gateB8Section), false, 'Gate C "all prior gates pass" cannot be checked while Gate B8 has unchecked items');
}

if (rolloutAuthorizedState === 'checked') {
  assert.equal(allPriorGatesState, 'checked', 'Gate C "conformance rollout authorized" requires "all prior gates pass" to be checked first');
}

console.log('usr gate-c prerequisite lock validation checks passed');
