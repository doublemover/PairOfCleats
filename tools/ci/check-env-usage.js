#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fdir } from 'fdir';
import { resolveToolRoot } from '../shared/dict-utils.js';
import { toPosix } from '../../src/shared/files.js';

const root = resolveToolRoot();
const allowedFile = toPosix(path.join(root, 'src', 'shared', 'env.js'));
const envNameRegex = /PAIROFCLEATS_[A-Z0-9_]+/g;
const envRegexes = [
  /process\.env\s*\??\.\s*PAIROFCLEATS_[A-Z0-9_]+/g,
  /process\.env\s*\??\[\s*['"]PAIROFCLEATS_[A-Z0-9_]+['"]\s*\]/g,
  /\{\s*[^}]*PAIROFCLEATS_[A-Z0-9_]+[^}]*}\s*=\s*process\.env/g
];

const listSourceFiles = async () => {
  const files = await new fdir().withFullPaths().crawl(root).withPromise();
  return files.filter((filePath) => {
    if (!filePath.endsWith('.js')) return false;
    const normalized = toPosix(filePath);
    if (normalized.includes('/node_modules/')) return false;
    if (normalized.includes('/.git/')) return false;
    if (normalized.includes('/tests/')) return false;
    if (normalized.includes('/docs/')) return false;
    if (normalized.includes('/worktrees/')) return false;
    if (normalized.includes('/.worktrees/')) return false;
    return true;
  });
};

const run = async () => {
  const files = await listSourceFiles();
  const violations = [];

  for (const filePath of files) {
    const normalized = toPosix(filePath);
    if (normalized === allowedFile) continue;
    const source = await fs.readFile(filePath, 'utf8');
    const matches = new Set();
    for (const regex of envRegexes) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(source)) !== null) {
        const names = match[0].match(envNameRegex) || [];
        names.forEach((name) => matches.add(`process.env.${name}`));
      }
    }
    if (matches.size) {
      violations.push({
        file: toPosix(path.relative(root, filePath)),
        vars: Array.from(matches).sort()
      });
    }
  }

  if (violations.length) {
    console.error('[env-usage] process.env.PAIROFCLEATS_* usage found outside src/shared/env.js');
    for (const entry of violations) {
      console.error(`- ${entry.file}: ${entry.vars.join(', ')}`);
    }
    process.exit(1);
  }
};

await run();
