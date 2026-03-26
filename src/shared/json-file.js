import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonFileSafe, readJsonFileSyncSafe } from './file-read.js';

export async function readJsonFile(filePath, { reviver = undefined } = {}) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw, reviver);
}

export async function writeJsonFile(filePath, value, {
  spaces = 2,
  finalNewline = true
} = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const serialized = JSON.stringify(value, null, spaces);
  const content = finalNewline ? `${serialized}\n` : serialized;
  await fs.writeFile(filePath, content, 'utf8');
}

export function readJsonFileSyncSafeResolved(filePath, fallback = null) {
  if (!filePath) return fallback;
  return readJsonFileSyncSafe(path.resolve(filePath), { fallback });
}

export async function readJsonFileResolved(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const raw = await fs.readFile(resolved, 'utf8');
  return JSON.parse(raw);
}

export async function readJsonFileResolvedSafe(filePath, fallback = null) {
  if (!filePath) return fallback;
  return readJsonFileSafe(path.resolve(filePath), { fallback });
}

export async function writeJsonFileResolved(filePath, payload, options = {}) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  await writeJsonFile(resolved, payload, {
    spaces: options?.spaces ?? 2,
    finalNewline: options?.trailingNewline === true || options?.finalNewline === true
  });
  return resolved;
}

export function writeJsonFileSyncResolved(filePath, payload, options = {}) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  const spaces = options?.spaces ?? 2;
  const finalNewline = options?.trailingNewline === true || options?.finalNewline === true;
  const serialized = JSON.stringify(payload, null, spaces);
  const content = finalNewline ? `${serialized}\n` : serialized;
  const directory = path.dirname(resolved);
  fsSync.mkdirSync(directory, { recursive: true });
  fsSync.writeFileSync(resolved, content, 'utf8');
  return resolved;
}
