#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { repoRoot } from '../../helpers/root.js';

applyTestEnv();

const root = repoRoot();
const roadmapPath = path.join(root, 'DUPEMAP.md');
const roadmap = fs.readFileSync(roadmapPath, 'utf8');

const statusByPhase = new Map();
for (const line of roadmap.split(/\r?\n/)) {
  const match = line.match(/^\|\s+(F\d)\s+\|\s+\[([^\]])\]\s+\|/);
  if (!match) continue;
  statusByPhase.set(match[1], match[2].toLowerCase());
}

const completedPhases = Array.from(statusByPhase.entries())
  .filter(([phase, status]) => /^F\d+$/.test(phase) && phase !== 'F0' && status === 'x')
  .map(([phase]) => phase)
  .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

const getPhaseSection = (phase) => {
  const startToken = `### Phase ${phase} —`;
  const start = roadmap.indexOf(startToken);
  assert.ok(start >= 0, `missing phase section: ${phase}`);
  const end = roadmap.indexOf('\n### Phase ', start + startToken.length);
  return end >= 0 ? roadmap.slice(start, end) : roadmap.slice(start);
};

const extractTestBlock = (section, phase) => {
  const match = section.match(/\nTests:\n([\s\S]*?)\n\nExit criteria:/);
  assert.ok(match, `missing Tests block for ${phase}`);
  return match[1];
};

for (const phase of completedPhases) {
  const section = getPhaseSection(phase);
  const testsBlock = extractTestBlock(section, phase);
  const bullets = testsBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ['));

  assert.ok(bullets.length > 0, `${phase} has no test bullets`);
  const unchecked = bullets.filter((line) => line.startsWith('- [ ]'));
  assert.equal(unchecked.length, 0, `${phase} has unchecked tests in a completed phase`);

  const referencedTests = [];
  for (const bullet of bullets) {
    const matches = bullet.match(/`([^`]+\.test\.js)`/g) || [];
    for (const raw of matches) {
      referencedTests.push(raw.slice(1, -1));
    }
  }
  assert.ok(referencedTests.length > 0, `${phase} has no concrete test file references`);

  for (const relPath of referencedTests) {
    const fullPath = path.join(root, relPath);
    assert.ok(fs.existsSync(fullPath), `${phase} references missing test file: ${relPath}`);
  }
}

console.log('findings test-evidence contract passed');
