#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { escapeRegex } from '../../src/shared/text/escape-regex.js';

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const requireBreaking = hasFlag('--breaking');
const blockersOnly = hasFlag('--blockers-only');
const noBlockers = hasFlag('--no-blockers');
const allowBlockerOverride = hasFlag('--allow-blocker-override');

const readOption = (name) => {
  const flag = `--${name}`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === flag) {
      const next = args[i + 1];
      return typeof next === 'string' ? next : '';
    }
    if (typeof arg === 'string' && arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return '';
};

const readMultiOption = (name) => {
  const flag = `--${name}`;
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === flag) {
      const next = args[i + 1];
      if (typeof next === 'string' && next.trim()) values.push(next.trim());
      continue;
    }
    if (typeof arg === 'string' && arg.startsWith(`${flag}=`)) {
      const raw = arg.slice(flag.length + 1).trim();
      if (raw) values.push(raw);
    }
  }
  return values;
};

if (hasFlag('--help') || hasFlag('-h')) {
  console.error('Usage: node tools/release/check.js [options]');
  console.error('');
  console.error('Options:');
  console.error('  --breaking                     Require non-empty "### Breaking" notes for current version.');
  console.error('  --blockers-only                Skip changelog checks and run essential reliability blockers only.');
  console.error('  --no-blockers                  Skip essential reliability blockers.');
  console.error('  --allow-blocker-override       Allow explicit blocker override for failing blockers.');
  console.error('  --override-id <id>             Blocker ID to override (repeatable).');
  console.error('  --override-marker <marker>     Required marker (ticket/incident ID) for overrides.');
  process.exit(0);
}

const overrideMarker = readOption('override-marker').trim();
const overrideIds = new Set([
  ...readMultiOption('override-id'),
  ...readMultiOption('override-ids')
    .flatMap((entry) => String(entry).split(',').map((value) => value.trim()))
    .filter(Boolean)
]);

const ESSENTIAL_BLOCKERS = Object.freeze([
  {
    id: 'ops-health-contract',
    owner: 'ops-runtime',
    command: [process.execPath, 'tests/ops/health-check-contract.test.js']
  },
  {
    id: 'ops-failure-injection-contract',
    owner: 'ops-runtime',
    command: [process.execPath, 'tests/ops/failure-injection/retrieval-hotpath.test.js']
  },
  {
    id: 'ops-config-guardrails-contract',
    owner: 'ops-runtime',
    command: [process.execPath, 'tests/ops/config/guardrails.test.js']
  }
]);

const root = process.cwd();
const packagePath = path.join(root, 'package.json');
const changelogPath = path.join(root, 'CHANGELOG.md');

if (!blockersOnly) {
  if (!fs.existsSync(packagePath)) {
    console.error('release-check: package.json not found.');
    process.exit(1);
  }
  if (!fs.existsSync(changelogPath)) {
    console.error('release-check: CHANGELOG.md not found.');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const version = pkg?.version ? String(pkg.version).trim() : '';
  if (!version) {
    console.error('release-check: package.json version missing.');
    process.exit(1);
  }

  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const headerRe = new RegExp(`^##\\s+v?${escapeRegex(version)}(\\b|\\s)`, 'm');
  const match = headerRe.exec(changelog);
  if (!match) {
    console.error(`release-check: CHANGELOG.md missing section for v${version}.`);
    process.exit(1);
  }

  const sectionStart = match.index;
  const nextHeaderMatch = changelog.slice(sectionStart + match[0].length).match(/^##\s+/m);
  const sectionEnd = nextHeaderMatch
    ? sectionStart + match[0].length + nextHeaderMatch.index
    : changelog.length;
  const section = changelog.slice(sectionStart, sectionEnd);

  if (requireBreaking) {
    const breakingHeader = section.match(/^###\s+Breaking\s*$/m);
    if (!breakingHeader) {
      console.error(`release-check: missing "### Breaking" section for v${version}.`);
      process.exit(1);
    }
    const afterBreaking = section.slice(breakingHeader.index + breakingHeader[0].length);
    const nextSubsection = afterBreaking.match(/^###\s+/m);
    const breakingBlock = nextSubsection
      ? afterBreaking.slice(0, nextSubsection.index)
      : afterBreaking;
    const bullets = breakingBlock.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('-'));
    const hasRealEntry = bullets.some((line) => !line.toLowerCase().includes('none'));
    if (!bullets.length || !hasRealEntry) {
      console.error(`release-check: add breaking change notes under v${version}.`);
      process.exit(1);
    }
  }
  console.error(`release-check: changelog entry ok for v${version}.`);
}

if (!noBlockers) {
  const failing = [];
  const overridden = [];
  for (const blocker of ESSENTIAL_BLOCKERS) {
    const [command, ...commandArgs] = blocker.command;
    const run = spawnSync(command, commandArgs, {
      cwd: root,
      env: { ...process.env, PAIROFCLEATS_TESTING: process.env.PAIROFCLEATS_TESTING || '1' },
      encoding: 'utf8'
    });
    if (run.status === 0) {
      console.error(`release-check: blocker ok (${blocker.id}, owner=${blocker.owner}).`);
      continue;
    }
    const detail = String(run.stderr || run.stdout || `exit ${run.status ?? 'unknown'}`).trim();
    const canOverride = allowBlockerOverride
      && overrideMarker
      && overrideIds.has(blocker.id);
    if (canOverride) {
      overridden.push(blocker.id);
      const audit = {
        type: 'release-blocker-override',
        blockerId: blocker.id,
        owner: blocker.owner,
        marker: overrideMarker,
        at: new Date().toISOString(),
        detail
      };
      console.error(`[release-override] ${JSON.stringify(audit)}`);
      continue;
    }
    failing.push({
      ...blocker,
      detail
    });
  }
  if (failing.length) {
    for (const blocker of failing) {
      console.error(
        `release-check: blocker failed (${blocker.id}, owner=${blocker.owner}). `
        + 'Override path: --allow-blocker-override --override-id <id> --override-marker <ticket>.'
      );
      if (blocker.detail) {
        console.error(`release-check: ${blocker.id} detail: ${blocker.detail}`);
      }
    }
    process.exit(1);
  }
  for (const overrideId of overrideIds) {
    if (!overridden.includes(overrideId)) {
      console.error(`release-check: override marker unused for blocker ${overrideId}.`);
    }
  }
}
