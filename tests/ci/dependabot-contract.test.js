#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

ensureTestingEnv(process.env);

const root = process.cwd();
const dependabotPath = path.join(root, '.github', 'dependabot.yml');

if (!fs.existsSync(dependabotPath)) {
  console.error(`Missing Dependabot config: ${dependabotPath}`);
  process.exit(1);
}

const config = parse(fs.readFileSync(dependabotPath, 'utf8'));
const updates = Array.isArray(config?.updates) ? config.updates : [];
const required = new Map([
  ['npm', { directory: '/', label: 'npm', prefix: 'deps', limit: 10 }],
  ['cargo', { directory: '/crates/pairofcleats-tui', label: 'cargo', prefix: 'deps', limit: 10 }],
  ['github-actions', { directory: '/', label: 'github-actions', prefix: 'ci', limit: 5 }]
]);

if (updates.length !== required.size) {
  console.error(`Dependabot contract failed: expected ${required.size} update entries, found ${updates.length}`);
  process.exit(1);
}

for (const [ecosystem, expectation] of required) {
  const entry = updates.find((item) => item?.['package-ecosystem'] === ecosystem);
  if (!entry) {
    console.error(`Dependabot contract failed: missing ${ecosystem} entry`);
    process.exit(1);
  }
  if (entry.directory !== expectation.directory) {
    console.error(
      `Dependabot contract failed: ${ecosystem} directory expected ${expectation.directory}, got ${entry.directory}`
    );
    process.exit(1);
  }
  if (entry['open-pull-requests-limit'] !== expectation.limit) {
    console.error(
      `Dependabot contract failed: ${ecosystem} open-pull-requests-limit expected ${expectation.limit}, got ${entry['open-pull-requests-limit']}`
    );
    process.exit(1);
  }
  if (entry?.schedule?.interval !== 'weekly'
    || entry?.schedule?.day !== 'monday'
    || entry?.schedule?.time !== '06:00'
    || entry?.schedule?.timezone !== 'America/New_York') {
    console.error(`Dependabot contract failed: ${ecosystem} schedule is not the expected weekly Monday 06:00 America/New_York policy`);
    process.exit(1);
  }
  const labels = Array.isArray(entry.labels) ? entry.labels : [];
  if (!labels.includes('dependencies') || !labels.includes(expectation.label)) {
    console.error(`Dependabot contract failed: ${ecosystem} labels must include dependencies and ${expectation.label}`);
    process.exit(1);
  }
  if (entry?.['commit-message']?.prefix !== expectation.prefix) {
    console.error(
      `Dependabot contract failed: ${ecosystem} commit-message prefix expected ${expectation.prefix}, got ${entry?.['commit-message']?.prefix}`
    );
    process.exit(1);
  }
}

console.log('dependabot contract test passed');
