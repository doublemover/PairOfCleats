import fs from 'node:fs';
import path from 'node:path';
import { escapeRegex } from '../../src/shared/text/escape-regex.js';

const normalizeText = (value) => String(value || '').trim();

export const toIso = (value = Date.now()) => new Date(value).toISOString();

export const readJsonFile = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

export const readPackageVersion = (rootDir) => {
  const packagePath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packagePath)) {
    throw new Error('release metadata: package.json not found.');
  }
  const pkg = readJsonFile(packagePath);
  const version = normalizeText(pkg?.version);
  if (!version) {
    throw new Error('release metadata: package.json version missing.');
  }
  return { packagePath, version, packageName: normalizeText(pkg?.name) };
};

export const extractChangelogSection = (rootDir, version) => {
  const changelogPath = path.join(rootDir, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) {
    throw new Error('release metadata: CHANGELOG.md not found.');
  }
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const headerRe = new RegExp(`^##\\s+v?${escapeRegex(version)}(\\b|\\s)`, 'm');
  const match = headerRe.exec(changelog);
  if (!match) {
    throw new Error(`release metadata: CHANGELOG.md missing section for v${version}.`);
  }
  const sectionStart = match.index;
  const nextHeaderMatch = changelog.slice(sectionStart + match[0].length).match(/^##\s+/m);
  const sectionEnd = nextHeaderMatch
    ? sectionStart + match[0].length + nextHeaderMatch.index
    : changelog.length;
  const section = changelog.slice(sectionStart, sectionEnd).trim();
  return { changelogPath, section };
};

const readTomlPackageVersion = (filePath) => {
  const body = fs.readFileSync(filePath, 'utf8');
  const packageSectionMatch = body.match(/\[package\]([\s\S]*?)(?:\n\[|$)/);
  if (!packageSectionMatch) {
    return '';
  }
  const versionMatch = packageSectionMatch[1].match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  return normalizeText(versionMatch?.[1]);
};

const getObjectPath = (value, selector) => {
  let current = value;
  for (const part of selector.split('.')) {
    if (!part) continue;
    if (!current || typeof current !== 'object' || !(part in current)) {
      return '';
    }
    current = current[part];
  }
  return normalizeText(current);
};

export const resolveVersionSource = (rootDir, source) => {
  const text = normalizeText(source);
  if (!text) {
    return { source: text, path: '', selector: '', version: '' };
  }
  const hashIndex = text.indexOf('#');
  const relPath = hashIndex >= 0 ? text.slice(0, hashIndex) : text;
  const selector = hashIndex >= 0 ? text.slice(hashIndex + 1) : '';
  const absolutePath = path.resolve(rootDir, relPath);
  let version = '';
  if (absolutePath.endsWith('.json')) {
    version = getObjectPath(readJsonFile(absolutePath), selector);
  } else if (absolutePath.endsWith('Cargo.toml')) {
    version = selector === 'package.version' ? readTomlPackageVersion(absolutePath) : '';
  }
  return {
    source: text,
    path: absolutePath,
    selector,
    version
  };
};

export const normalizeReleaseTag = (value) => {
  const text = normalizeText(value);
  if (!text) return '';
  return text.startsWith('refs/tags/') ? text.slice('refs/tags/'.length) : text;
};

export const validateReleaseTag = ({ tag, version }) => {
  const normalizedTag = normalizeReleaseTag(tag);
  if (!normalizedTag) return '';
  const expected = `v${version}`;
  if (normalizedTag !== expected) {
    throw new Error(`release metadata: tag ${normalizedTag} does not match expected ${expected}.`);
  }
  return normalizedTag;
};
