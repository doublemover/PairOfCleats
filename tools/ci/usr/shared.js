import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonFile, writeJsonFile } from '../../../src/shared/json-file.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const repoPath = (...segments) => path.join(ROOT, ...segments);

export const parseGateArgs = () => {
  const args = process.argv.slice(2);
  const out = { out: '', strict: true };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--out') {
      out.out = args[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--no-strict') {
      out.strict = false;
    }
  }
  return out;
};

export const readJsonFromRoot = (relativePath) => readJsonFile(repoPath(relativePath));

export const readTextFromRoot = (relativePath) => fs.readFile(repoPath(relativePath), 'utf8');

export const readConfig = (absolutePath) => readJsonFile(absolutePath);

export const ensureArray = (value) => (Array.isArray(value) ? value : []);

export const writeGateReport = async ({ argv, config, report }) => {
  const defaultOut = repoPath('.diagnostics', 'usr', config.report);
  const outPath = argv.out ? path.resolve(argv.out) : defaultOut;
  await writeJsonFile(outPath, report);
};

export const finishGate = ({ report, passedMessage, failedMessage, strict }) => {
  if (report.ok) {
    console.error(passedMessage);
    return;
  }

  console.error(failedMessage);
  for (const error of report.errors) {
    console.error(`- ${error}`);
  }

  if (strict) {
    process.exit(1);
  }
};
