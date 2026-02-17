#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

const defaults = {
  dir: path.join(root, 'src', 'lang', 'lexicon', 'wordlists'),
  schema: path.join(root, 'src', 'lang', 'lexicon', 'language-lexicon-wordlist.schema.json'),
  json: false
};

const parseArgs = (argv) => {
  const out = { ...defaults };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--dir') {
      out.dir = path.resolve(argv[i + 1] || out.dir);
      i += 1;
      continue;
    }
    if (arg === '--schema') {
      out.schema = path.resolve(argv[i + 1] || out.schema);
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node tools/lexicon/validate.js [--json] [--dir <path>] [--schema <path>]');
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${arg}`);
  }
  return out;
};

const isAsciiToken = (value) => typeof value === 'string' && /^[\x21-\x7E]+$/.test(value);

const validateWordlistArrays = (payload, filePath) => {
  const errors = [];
  const listKeys = ['keywords', 'literals', 'types', 'builtins', 'modules'];
  for (const key of listKeys) {
    const values = Array.isArray(payload[key]) ? payload[key] : [];
    const seen = new Set();
    for (const raw of values) {
      if (typeof raw !== 'string') {
        errors.push(`${filePath}: ${key} has non-string entry`);
        continue;
      }
      const value = raw.trim();
      if (value !== raw) {
        errors.push(`${filePath}: ${key} contains untrimmed token "${raw}"`);
      }
      if (value !== value.toLowerCase()) {
        errors.push(`${filePath}: ${key} contains non-lowercase token "${raw}"`);
      }
      if (!isAsciiToken(value)) {
        errors.push(`${filePath}: ${key} contains non-ASCII token "${raw}"`);
      }
      if (seen.has(value)) {
        errors.push(`${filePath}: ${key} contains duplicate token "${raw}"`);
      }
      seen.add(value);
    }
  }
  return errors;
};

const main = async () => {
  const options = parseArgs(process.argv);
  const schema = JSON.parse(await fs.readFile(options.schema, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  let files = [];
  try {
    const entries = await fs.readdir(options.dir, { withFileTypes: true });
    files = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    throw new Error(`Failed to read wordlist directory: ${error?.message || error}`);
  }

  const errors = [];
  const perFile = [];
  for (const fileName of files) {
    const filePath = path.join(options.dir, fileName);
    let payload;
    try {
      payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      errors.push(`${filePath}: invalid JSON (${error?.message || error})`);
      continue;
    }

    const ok = validate(payload);
    if (!ok) {
      const schemaErrors = (validate.errors || []).map((entry) => {
        const pointer = entry.instancePath ? `#${entry.instancePath}` : '#';
        return `${filePath}: schema ${pointer} ${entry.message || 'is invalid'}`;
      });
      errors.push(...schemaErrors);
    }

    const expectedLanguageId = path.basename(fileName, '.json');
    if (payload?.languageId !== expectedLanguageId) {
      errors.push(
        `${filePath}: languageId must match filename (expected "${expectedLanguageId}", got "${payload?.languageId ?? ''}")`
      );
    }

    errors.push(...validateWordlistArrays(payload || {}, filePath));

    perFile.push({
      file: fileName,
      languageId: typeof payload?.languageId === 'string' ? payload.languageId : null,
      keywords: Array.isArray(payload?.keywords) ? payload.keywords.length : 0,
      literals: Array.isArray(payload?.literals) ? payload.literals.length : 0
    });
  }

  if (!files.length) {
    errors.push(`No wordlist files found in ${options.dir}`);
  }

  const result = {
    ok: errors.length === 0,
    dir: options.dir,
    schema: options.schema,
    files: perFile,
    counts: {
      filesScanned: files.length,
      errors: errors.length
    },
    errors
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[lexicon:validate] files=${result.counts.filesScanned} errors=${result.counts.errors}`);
    if (!result.ok) {
      for (const error of errors) {
        console.error(`- ${error}`);
      }
    }
  }

  if (!result.ok) process.exit(1);
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
