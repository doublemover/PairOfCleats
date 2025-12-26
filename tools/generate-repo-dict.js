#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';
import ignore from 'ignore';
import { getDictConfig, getRepoDictPath, loadUserConfig } from './dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  string: ['out', 'extensions'],
  boolean: ['include-prose'],
  default: { 'min-count': 3, 'include-prose': false }
});

const repoRoot = process.cwd();
const userConfig = loadUserConfig(repoRoot);
const dictConfig = getDictConfig(repoRoot, userConfig);
const outputPath = argv.out ? path.resolve(argv.out) : getRepoDictPath(repoRoot, dictConfig);
const minCount = Math.max(1, parseInt(argv['min-count'], 10) || 3);

const defaultExts = [
  '.js', '.mjs', '.cjs',
  '.ts', '.tsx',
  '.py', '.rb', '.go',
  '.java', '.kt',
  '.swift', '.m', '.mm',
  '.c', '.cc', '.cpp', '.h', '.hpp',
  '.yml', '.yaml', '.json',
  '.sh', '.bash',
  '.html', '.css'
];
if (argv['include-prose']) defaultExts.push('.md', '.txt');

const extList = argv.extensions
  ? argv.extensions.split(',').map((ext) => ext.trim()).filter(Boolean)
  : defaultExts;
const exts = new Set(extList.map((ext) => ext.startsWith('.') ? ext : `.${ext}`));

function splitId(input) {
  return input
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .split(/[^a-zA-Z0-9]+/u)
    .flatMap((tok) => tok.split(/(?<=.)(?=[A-Z])/))
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

async function listFiles() {
  const rg = spawnSync('rg', ['--files'], { cwd: repoRoot, encoding: 'utf8' });
  if (rg.status === 0 && rg.stdout) {
    return rg.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  const ignoreMatcher = ignore();
  const ignoreFiles = ['.gitignore', '.pairofcleatsignore'];
  for (const ignoreFile of ignoreFiles) {
    try {
      const ignorePath = path.join(repoRoot, ignoreFile);
      const contents = await fs.readFile(ignorePath, 'utf8');
      ignoreMatcher.add(contents);
    } catch {}
  }

  const skipDirs = new Set(['.git', 'node_modules', 'dist', 'coverage', 'index-code', 'index-prose', '.repoMetrics']);
  const files = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(repoRoot, fullPath).split(path.sep).join('/');
      const ignoreKey = entry.isDirectory() ? `${relPath}/` : relPath;
      if (ignoreMatcher.ignores(ignoreKey)) continue;
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        await walk(fullPath);
      } else {
        files.push(relPath);
      }
    }
  }

  await walk(repoRoot);
  return files;
}

const files = await listFiles();
const counts = new Map();
const tokenRegex = /[A-Za-z][A-Za-z0-9_]{2,}/g;

for (const relPath of files) {
  const ext = path.extname(relPath).toLowerCase();
  if (!exts.has(ext)) continue;
  const absPath = path.join(repoRoot, relPath);
  let text;
  try {
    text = await fs.readFile(absPath, 'utf8');
  } catch {
    continue;
  }

  const matches = text.match(tokenRegex);
  if (!matches) continue;
  for (const raw of matches) {
    const parts = splitId(raw);
    for (const part of parts) {
      if (part.length < 3) continue;
      counts.set(part, (counts.get(part) || 0) + 1);
    }
  }
}

const sorted = [...counts.entries()]
  .filter(([, count]) => count >= minCount)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const output = sorted.map(([word]) => word).join('\n');
await fs.writeFile(outputPath, output ? `${output}\n` : '');

console.log(`Wrote ${sorted.length} entries to ${outputPath}`);
