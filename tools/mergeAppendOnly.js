#!/usr/bin/env node
import fs from 'node:fs/promises';

/**
 * Read non-empty trimmed lines from a file.
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
async function readLines(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Merge append-only line files, preserving existing target order.
 * @param {string} baseFile
 * @param {string} targetFile
 * @returns {Promise<void>}
 */
export async function mergeAppendOnly(baseFile, targetFile) {
  const baseLines = await readLines(baseFile);
  const targetLines = await readLines(targetFile);
  const seen = new Set(targetLines);
  const merged = targetLines.slice();

  for (const line of baseLines) {
    if (seen.has(line)) continue;
    seen.add(line);
    merged.push(line);
  }

  const output = merged.length ? `${merged.join('\n')}\n` : '';
  await fs.writeFile(targetFile, output);
}

const [baseFile, targetFile] = process.argv.slice(2);
if (!baseFile || !targetFile) {
  console.error('usage: mergeAppendOnly.js <baseFile> <targetFile>');
  process.exit(1);
}

await mergeAppendOnly(baseFile, targetFile);
