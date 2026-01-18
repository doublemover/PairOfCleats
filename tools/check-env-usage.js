#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fdir } from 'fdir';
import { resolveToolRoot } from './dict-utils.js';

const root = resolveToolRoot();
const allowedFile = path.join(root, 'src', 'shared', 'env.js').replace(/\\/g, '/');
const envRegex = /process\.env\s*\.\s*PAIROFCLEATS_[A-Z0-9_]+/g;

const listSourceFiles = async () => {
  const files = await new fdir().withFullPaths().crawl(root).withPromise();
  return files.filter((filePath) => {
    if (!filePath.endsWith('.js')) return false;
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.includes('/node_modules/')) return false;
    if (normalized.includes('/.git/')) return false;
    if (normalized.includes('/tests/')) return false;
    if (normalized.includes('/docs/')) return false;
    return true;
  });
};

const run = async () => {
  const files = await listSourceFiles();
  const violations = [];

  for (const filePath of files) {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized === allowedFile) continue;
    const source = await fs.readFile(filePath, 'utf8');
    const matches = source.match(envRegex);
    if (matches && matches.length) {
      violations.push({
        file: path.relative(root, filePath).replace(/\\/g, '/'),
        vars: Array.from(new Set(matches)).sort()
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
