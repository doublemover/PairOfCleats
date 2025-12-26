#!/usr/bin/env node
import fs from 'node:fs/promises';

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
