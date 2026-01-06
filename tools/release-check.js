#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const requireBreaking = args.includes('--breaking')
  || process.env.PAIROFCLEATS_BREAKING === '1';

const root = process.cwd();
const packagePath = path.join(root, 'package.json');
const changelogPath = path.join(root, 'CHANGELOG.md');

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
const headerRe = new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}(\\b|\\s)`, 'm');
const match = headerRe.exec(changelog);
if (!match) {
  console.error(`release-check: CHANGELOG.md missing section for v${version}.`);
  process.exit(1);
}

const sectionStart = match.index;
const nextHeaderMatch = changelog.slice(sectionStart + match[0].length).match(/^##\\s+/m);
const sectionEnd = nextHeaderMatch
  ? sectionStart + match[0].length + nextHeaderMatch.index
  : changelog.length;
const section = changelog.slice(sectionStart, sectionEnd);

if (requireBreaking) {
  const breakingHeader = section.match(/^###\\s+Breaking\\s*$/m);
  if (!breakingHeader) {
    console.error(`release-check: missing "### Breaking" section for v${version}.`);
    process.exit(1);
  }
  const afterBreaking = section.slice(breakingHeader.index + breakingHeader[0].length);
  const nextSubsection = afterBreaking.match(/^###\\s+/m);
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

console.log(`release-check: changelog entry ok for v${version}.`);
