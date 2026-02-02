#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const README = path.join(ROOT, 'README.md');

const isExternal = (value) => (
  value.startsWith('http://')
  || value.startsWith('https://')
  || value.startsWith('mailto:')
  || value.startsWith('tel:')
  || value.startsWith('data:')
);

const cleanLink = (raw) => {
  let value = raw.trim();
  if (value.startsWith('<') && value.endsWith('>')) {
    value = value.slice(1, -1).trim();
  }
  const hashIndex = value.indexOf('#');
  if (hashIndex >= 0) value = value.slice(0, hashIndex);
  const queryIndex = value.indexOf('?');
  if (queryIndex >= 0) value = value.slice(0, queryIndex);
  return value.trim();
};

const walkMarkdown = async (dir, out = []) => {
  const entries = await fsPromises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) out.push(fullPath);
  }
  return out;
};

const files = [];
if (fs.existsSync(README)) files.push(README);
const docsRoot = path.join(ROOT, 'docs');
if (fs.existsSync(docsRoot)) {
  await walkMarkdown(docsRoot, files);
}

const linkRegex = /!?\[[^\]]*\]\(([^)]+)\)/g;
const missing = [];

for (const file of files) {
  const text = await fsPromises.readFile(file, 'utf8');
  const lines = text.split(/\r?\n/);
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    let match;
    while ((match = linkRegex.exec(line)) !== null) {
      const raw = match[1];
      if (!raw) continue;
      if (raw.startsWith('#')) continue;
      if (isExternal(raw)) continue;
      const cleaned = cleanLink(raw);
      if (!cleaned) continue;
      const target = cleaned.startsWith('/')
        ? path.join(ROOT, cleaned.slice(1))
        : path.resolve(path.dirname(file), cleaned);
      if (fs.existsSync(target)) continue;
      if (fs.existsSync(`${target}.md`)) continue;
      if (fs.existsSync(`${target}.mdx`)) continue;
      missing.push({ file, link: raw });
    }
  }
}

if (missing.length) {
  for (const entry of missing) {
    console.error(`Broken markdown link: ${entry.link} (${entry.file})`);
  }
  process.exit(1);
}

console.log('markdown link check passed');
