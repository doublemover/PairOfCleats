#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tablePath = path.join(root, 'docs', 'testing', 'truth-table.md');
let raw = '';
try {
  raw = fs.readFileSync(tablePath, 'utf8');
} catch (err) {
  console.error(`Failed to read truth table at ${tablePath}: ${err?.message || err}`);
  process.exit(1);
}

const lines = raw.split(/\r?\n/);
const claims = [];
let current = null;

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  const trimmed = line.trim();
  if (trimmed.startsWith('- Claim:')) {
    if (current) claims.push(current);
    current = { line: i + 1, lines: [line] };
    continue;
  }
  if (current) {
    if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
      claims.push(current);
      current = null;
      continue;
    }
    current.lines.push(line);
  }
}
if (current) claims.push(current);

if (!claims.length) {
  console.error('Truth table validation failed: no claims found.');
  process.exit(1);
}

const requiredLabels = ['Implementation:', 'Config:', 'Tests:', 'Limitations:'];
const issues = [];

const findLabelLine = (blockLines, label) => {
  for (const line of blockLines) {
    if (line.includes(label)) return line;
  }
  return null;
};

for (const claim of claims) {
  const blockText = claim.lines.join('\n');
  for (const label of requiredLabels) {
    const line = findLabelLine(claim.lines, label);
    if (!line) {
      issues.push(`Claim at line ${claim.line} missing ${label}`);
      continue;
    }
    const content = line.split(label)[1];
    if (!content || !content.trim()) {
      issues.push(`Claim at line ${claim.line} has empty ${label}`);
    }
  }
  const testsLine = findLabelLine(claim.lines, 'Tests:');
  if (testsLine && !/tests\//.test(testsLine)) {
    issues.push(`Claim at line ${claim.line} Tests line missing tests/ reference`);
  }
  if (!testsLine && /Tests:/.test(blockText)) {
    issues.push(`Claim at line ${claim.line} has malformed Tests line`);
  }
}

if (issues.length) {
  console.error('Truth table validation failed:');
  issues.forEach((issue) => console.error(`- ${issue}`));
  process.exit(1);
}

console.log(`Truth table validation passed (${claims.length} claims).`);
