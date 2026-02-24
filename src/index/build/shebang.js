import fs from 'node:fs/promises';
import { runBuildCleanupWithTimeout } from './cleanup-timeout.js';
const MAX_SHEBANG_READ_BYTES = 256;
const SHELL_INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'ksh', 'dash']);
const basenameAny = (value) => String(value || '').split(/[\\/]/).pop() || '';

const splitShebangTokens = (value) => (
  String(value || '')
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
);

const resolveInterpreterToken = (tokens) => {
  if (!Array.isArray(tokens) || !tokens.length) return '';
  let token = tokens[0] || '';
  const basename = basenameAny(token).toLowerCase();
  if (basename !== 'env') return basename;
  let index = 1;
  while (index < tokens.length && tokens[index].startsWith('-')) {
    index += 1;
  }
  if (index >= tokens.length) return '';
  token = tokens[index];
  return basenameAny(token).toLowerCase();
};

const detectShebangLanguageIdFromLine = (line) => {
  const raw = String(line || '');
  if (!raw.startsWith('#!')) return null;
  const tokens = splitShebangTokens(raw.slice(2));
  const interpreter = resolveInterpreterToken(tokens);
  if (!interpreter) return null;
  if (SHELL_INTERPRETERS.has(interpreter)) return 'shell';
  return null;
};

const readShebangLine = async (absPath) => {
  const file = await fs.open(absPath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(MAX_SHEBANG_READ_BYTES);
    const { bytesRead } = await file.read(buffer, 0, MAX_SHEBANG_READ_BYTES, 0);
    if (!bytesRead) return '';
    const sample = buffer.subarray(0, bytesRead).toString('utf8');
    const firstNewline = sample.search(/\r?\n/);
    return firstNewline === -1 ? sample : sample.slice(0, firstNewline);
  } finally {
    await runBuildCleanupWithTimeout({
      label: 'shebang.read.close',
      cleanup: () => file.close(),
      swallowTimeout: false
    });
  }
};

export const detectShebangLanguage = async (absPath) => {
  try {
    const firstLine = await readShebangLine(absPath);
    const languageId = detectShebangLanguageIdFromLine(firstLine);
    if (languageId === 'shell') {
      return { languageId, ext: '.sh' };
    }
  } catch {}
  return null;
};

export { detectShebangLanguageIdFromLine };
