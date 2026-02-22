#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const parseArgs = (argv) => {
  const out = {
    input: '',
    out: path.resolve(process.cwd(), 'assets', 'dictionary', 'packs'),
    profileVersion: ''
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--input') {
      out.input = argv[i + 1] ? String(argv[i + 1]) : '';
      i += 1;
    } else if (value === '--out') {
      out.out = argv[i + 1] ? String(argv[i + 1]) : out.out;
      i += 1;
    } else if (value === '--profile-version') {
      out.profileVersion = argv[i + 1] ? String(argv[i + 1]) : '';
      i += 1;
    }
  }
  out.input = out.input ? path.resolve(process.cwd(), out.input) : '';
  out.out = path.resolve(process.cwd(), out.out);
  out.profileVersion = out.profileVersion || `bench-${new Date().toISOString().slice(0, 10)}`;
  return out;
};

const normalizeWord = (value) => String(value || '').trim().toLowerCase();

const readWords = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return text
      .split(/\r?\n/)
      .map(normalizeWord)
      .filter((word) => word.length >= 3 && /^[a-z0-9_.:-]+$/i.test(word));
  } catch {
    return [];
  }
};

const listTxt = async (dirPath) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
      .map((entry) => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
};

const collectLanguageWords = async (inputDir) => {
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  const commonWords = new Set();
  const byLanguage = new Map();

  for (const entry of entries) {
    const fullPath = path.join(inputDir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'common.txt') {
      for (const word of await readWords(fullPath)) commonWords.add(word);
      continue;
    }
    if (!entry.isDirectory()) continue;
    const languageId = entry.name.trim().toLowerCase();
    const files = await listTxt(fullPath);
    if (!files.length) continue;
    const words = new Set();
    for (const filePath of files) {
      for (const word of await readWords(filePath)) words.add(word);
    }
    if (words.size) byLanguage.set(languageId, words);
  }

  return { commonWords, byLanguage };
};

const writeWordFile = async (filePath, words) => {
  const ordered = Array.from(words).sort((a, b) => a.localeCompare(b));
  await fs.writeFile(filePath, `${ordered.join('\n')}\n`, 'utf8');
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    throw new Error('usage: node tools/dictionary/build-pack.js --input <dir> [--out <dir>] [--profile-version <id>]');
  }
  const { commonWords, byLanguage } = await collectLanguageWords(args.input);
  await fs.mkdir(args.out, { recursive: true });

  const manifest = {
    schemaVersion: 1,
    profileVersion: args.profileVersion,
    generatedAt: new Date().toISOString(),
    common: [],
    languages: {}
  };

  if (commonWords.size > 0) {
    const commonFileName = 'common.txt';
    await writeWordFile(path.join(args.out, commonFileName), commonWords);
    manifest.common.push(commonFileName);
  }

  for (const [languageId, words] of byLanguage.entries()) {
    const fileName = `${languageId}.txt`;
    await writeWordFile(path.join(args.out, fileName), words);
    manifest.languages[languageId] = [fileName];
  }

  await fs.writeFile(path.join(args.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`dictionary pack written: ${args.out}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exit(1);
});
