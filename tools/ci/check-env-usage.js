#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fdir } from 'fdir';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { resolveToolRoot } from '../shared/dict-utils.js';
import { toPosix } from '../../src/shared/file-paths.js';

const envNameRegex = /PAIROFCLEATS_[A-Z0-9_]+/g;
const envRegexes = [
  /process\.env\s*\??\.\s*PAIROFCLEATS_[A-Z0-9_]+/g,
  /process\.env\s*\??\[\s*['"]PAIROFCLEATS_[A-Z0-9_]+['"]\s*\]/g,
  /\{\s*[^}]*PAIROFCLEATS_[A-Z0-9_]+[^}]*}\s*=\s*process\.env/g
];

const excludedDirectories = new Set(['node_modules', '.git', 'tests', 'docs', 'worktrees', '.worktrees', 'temp', '.tmp', '.testLogs']);

export const findEnvUsageViolations = async (root) => {
  const allowedFile = toPosix(path.join(root, 'src', 'shared', 'env.js'));
  const files = await new fdir().withFullPaths()
    .exclude(name => excludedDirectories.has(name))
    .filter(file => file.endsWith('.js')).crawl(root).withPromise();
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

  return violations;
};

const run = async () => {
  const violations = await findEnvUsageViolations(resolveToolRoot());
  if (violations.length) {
    console.error('[env-usage] process.env.PAIROFCLEATS_* usage found outside src/shared/env.js');
    for (const entry of violations) {
      console.error(`- ${entry.file}: ${entry.vars.join(', ')}`);
    }
    process.exit(1);
  }
};

if (isDirectExecution(import.meta.url)) await run();
