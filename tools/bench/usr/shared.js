import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const repoPath = (...segments) => path.join(ROOT, ...segments);

export const parseBenchArgs = () => {
  const args = process.argv.slice(2);
  const out = { json: '', quiet: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      out.json = args[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--quiet') {
      out.quiet = true;
    }
  }
  return out;
};

export const readJsonFileWithRaw = async (absolutePath) => {
  const raw = await fs.readFile(absolutePath, 'utf8');
  return { json: JSON.parse(raw), raw };
};

export const readJsonFromRoot = async (relativePath) => readJsonFileWithRaw(repoPath(relativePath));

export const readTextFromRoot = async (relativePath) => fs.readFile(repoPath(relativePath), 'utf8');

export const ensureArray = (value) => (Array.isArray(value) ? value : []);

export const hashInputs = (inputs) => {
  const h = crypto.createHash('sha256');
  for (const value of inputs) {
    h.update(value);
  }
  return h.digest('hex');
};

export const writeBenchJson = async (jsonPath, report) => {
  if (!jsonPath) {
    return;
  }
  const outPath = path.resolve(jsonPath);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
};
