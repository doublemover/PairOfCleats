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

export const USR_SOURCE_DIGEST_VERSION = 2;
export const USR_SOURCE_DIGEST_FORMAT = 'ordered-named-utf8-byte-frames/sha256-v2';
export const hashInputs = (inputs) => {
  if (!Array.isArray(inputs) || inputs.length > 1024) throw new TypeError('Named USR inputs must be a bounded ordered array.');
  const h = crypto.createHash('sha256').update('pairofcleats.usr.named-inputs.v2\0');
  const count = Buffer.alloc(4); count.writeUInt32BE(inputs.length); h.update(count);
  const frame = bytes => { const size=Buffer.alloc(8); size.writeBigUInt64BE(BigInt(bytes.byteLength)); h.update(size); h.update(bytes); };
  for (const input of inputs) {
    if (!input || typeof input !== 'object' || typeof input.role !== 'string' || !input.role || input.role.length > 4096
      || typeof input.path !== 'string' || !input.path || input.path.length > 4096
      || typeof input.value !== 'string' && !(input.value instanceof Uint8Array)) throw new TypeError('USR digest requires named string/byte inputs.');
    frame(Buffer.from(input.role,'utf8')); frame(Buffer.from(input.path,'utf8'));
    frame(typeof input.value === 'string' ? Buffer.from(input.value,'utf8') : input.value);
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
