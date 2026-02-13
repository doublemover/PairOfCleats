import { normalizeEol } from '../../src/shared/eol.js';

const NODE_ERROR_LINE = /(?:AssertionError|TypeError|ReferenceError|SyntaxError|RangeError|Error \[ERR_|node:internal|Error:)/;
const OUTPUT_SNIPPET_MAX_LINES = 7;

const clampOutputLines = (lines, limit = OUTPUT_SNIPPET_MAX_LINES) => {
  if (!Array.isArray(lines) || !lines.length) return [];
  if (!Number.isFinite(limit) || limit <= 0 || lines.length <= limit) return lines;
  const trimmed = lines.slice(0, limit);
  trimmed.push(`... trimmed ${lines.length - limit} lines`);
  return trimmed;
};

export const extractSkipReason = (stdout, stderr) => {
  const pickLine = (text) => {
    if (!text) return '';
    return normalizeEol(text)
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || '';
  };
  return pickLine(stdout) || pickLine(stderr) || 'skipped';
};

export const collectOutput = (stream, limit, onChunk) => {
  let size = 0;
  let data = '';
  if (!stream) return () => data;
  stream.on('data', (chunk) => {
    if (typeof chunk !== 'string') chunk = chunk.toString('utf8');
    size += chunk.length;
    if (size <= limit) {
      data += chunk;
    } else if (size - chunk.length < limit) {
      data += chunk.slice(0, Math.max(0, limit - (size - chunk.length)));
    }
    if (onChunk) onChunk(chunk);
  });
  return () => data;
};

export const extractOutputLines = (text, ignorePatterns = []) => {
  if (!text) return [];
  const normalized = normalizeEol(text);
  const lines = normalized.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .filter((line) => !ignorePatterns.some((pattern) => pattern.test(line)));
};

export const selectOutputLines = ({ stdout, stderr, mode, ignorePatterns = [], expandNodeErrors = true }) => {
  const rawLines = [
    ...extractOutputLines(stdout, ignorePatterns),
    ...extractOutputLines(stderr, ignorePatterns)
  ];
  if (!rawLines.length) return [];
  if (mode === 'success') return [];
  const lines = rawLines.filter((line) => !/^Node\.js v/i.test(line));
  if (!lines.length) return [];
  const hasNodeError = lines.some((line) => NODE_ERROR_LINE.test(line));
  if (mode === 'failure') {
    if (hasNodeError && expandNodeErrors) {
      const startIndex = Math.max(0, lines.findIndex((line) => NODE_ERROR_LINE.test(line)));
      return clampOutputLines(lines.slice(startIndex));
    }
    const matches = lines.filter((line) => /\[error\]|Failed\b/i.test(line));
    if (matches.length) return clampOutputLines(matches);
    return lines.length > 3 ? clampOutputLines(lines.slice(-OUTPUT_SNIPPET_MAX_LINES)) : lines.slice(-3);
  }
  return lines.slice(-3);
};

export const buildOutputSnippet = ({ stdout, stderr, mode, ignorePatterns = [] } = {}) => (
  selectOutputLines({ stdout, stderr, mode, ignorePatterns, expandNodeErrors: true })
);
