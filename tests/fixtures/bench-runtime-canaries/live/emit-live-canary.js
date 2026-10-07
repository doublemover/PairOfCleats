#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const readArgValue = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return '';
  return String(args[index + 1] || '').trim();
};

const fixtureId = readArgValue('--fixture');
const outPath = readArgValue('--out');

if (!fixtureId) {
  console.error('fixture id is required');
  process.exit(1);
}
if (!outPath) {
  console.error('out path is required');
  process.exit(1);
}

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures.json');
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const payload = fixtures[fixtureId];

if (!payload) {
  console.error(`unknown live canary fixture: ${fixtureId}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, fixtureId, outPath })}\n`);
