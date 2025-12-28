#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const roadmapPath = path.join(root, 'ROADMAP.md');
const planPath = path.join(root, 'COMPLETE_PLAN.md');
const readmePath = path.join(root, 'README.md');

const failures = [];
const roadmap = fs.existsSync(roadmapPath) ? fs.readFileSync(roadmapPath, 'utf8') : '';
const plan = fs.existsSync(planPath) ? fs.readFileSync(planPath, 'utf8') : '';
const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';

if (!plan) failures.push('COMPLETE_PLAN.md missing or empty.');
if (!roadmap) failures.push('ROADMAP.md missing or empty.');
if (roadmap && !roadmap.toLowerCase().includes('historical')) {
  failures.push('ROADMAP.md should be marked as historical.');
}
if (roadmap && !roadmap.includes('COMPLETE_PLAN.md')) {
  failures.push('ROADMAP.md should reference COMPLETE_PLAN.md as the source of truth.');
}
if (readme && !readme.includes('COMPLETE_PLAN.md')) {
  failures.push('README.md should reference COMPLETE_PLAN.md.');
}

if (failures.length) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('Docs consistency test passed');
