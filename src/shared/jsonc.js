import fs from 'node:fs';
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';

const describeSource = (source) => (source ? ` ${source}` : '');

export function parseJsoncText(rawText, source = '') {
  const text = typeof rawText === 'string' ? rawText : String(rawText ?? '');
  if (!text.trim()) {
    throw new Error(`Failed to parse${describeSource(source)}: empty file.`);
  }
  const errors = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length) {
    const first = errors[0];
    const code = typeof printParseErrorCode === 'function'
      ? printParseErrorCode(first.error)
      : String(first.error);
    throw new Error(`Failed to parse${describeSource(source)}: ${code}`);
  }
  return parsed;
}

export function readJsoncFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return parseJsoncText(raw, filePath);
}
