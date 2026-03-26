import fs from 'node:fs/promises';
import path from 'node:path';

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
