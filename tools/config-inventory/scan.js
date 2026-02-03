import fs from 'node:fs/promises';
import path from 'node:path';
import { fdir } from 'fdir';
import { toPosix } from '../../src/shared/files.js';

export const listSourceFiles = async (scanRoot) => {
  const files = await new fdir().withFullPaths().crawl(scanRoot).withPromise();
  return files.filter((filePath) => {
    if (!filePath.endsWith('.js')) return false;
    const normalized = toPosix(filePath);
    if (normalized.includes('/.testCache/')) return false;
    if (normalized.includes('/.testLogs/')) return false;
    if (normalized.includes('/tests/.cache/')) return false;
    if (normalized.includes('/.cache/')) return false;
    if (normalized.includes('/.logs/')) return false;
    if (normalized.includes('/.venv/')) return false;
    if (normalized.includes('/.diagnostics/')) return false;
    if (normalized.includes('/node_modules/')) return false;
    if (normalized.includes('/.git/')) return false;
    if (normalized.includes('/worktrees/')) return false;
    if (normalized.includes('/.worktrees/')) return false;
    if (normalized.includes('/benchmarks/repos/')) return false;
    if (normalized.includes('/benchmarks/cache/')) return false;
    if (normalized.includes('/benchmarks/results/')) return false;
    return true;
  });
};

export const findMatchingBrace = (source, startIndex) => {
  let depth = 0;
  let inString = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

export const extractOptionObjects = (source) => {
  const ranges = [];
  const patterns = [
    /\boptions\s*:\s*\{/g,
    /\.options\s*\(\s*\{/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const braceIndex = source.indexOf('{', match.index);
      if (braceIndex < 0) continue;
      const endIndex = findMatchingBrace(source, braceIndex);
      if (endIndex < 0) continue;
      ranges.push(source.slice(braceIndex, endIndex + 1));
      pattern.lastIndex = endIndex + 1;
    }
  }
  return ranges;
};

export const extractStringArray = (source, name) => {
  const regex = new RegExp(`\\b${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm');
  const match = regex.exec(source);
  if (!match) return [];
  const body = match[1] || '';
  const values = new Set();
  const stringRegex = /['"]([^'"\\]+)['"]/g;
  let stringMatch;
  while ((stringMatch = stringRegex.exec(body)) !== null) {
    if (stringMatch[1]) values.add(stringMatch[1]);
  }
  return Array.from(values);
};

export const extractTopLevelKeys = (objectText) => {
  const keys = new Set();
  let i = 1;
  const len = objectText.length;
  const skipWhitespace = () => {
    while (i < len && /\s/.test(objectText[i])) i += 1;
  };
  const skipComments = () => {
    while (i < len) {
      if (objectText[i] === '/' && objectText[i + 1] === '/') {
        i += 2;
        while (i < len && objectText[i] !== '\n') i += 1;
        continue;
      }
      if (objectText[i] === '/' && objectText[i + 1] === '*') {
        i += 2;
        while (i < len && !(objectText[i] === '*' && objectText[i + 1] === '/')) i += 1;
        i += 2;
        continue;
      }
      break;
    }
  };
  const parseString = (quote) => {
    let value = '';
    i += 1;
    while (i < len) {
      const ch = objectText[i];
      if (ch === '\\') {
        value += ch;
        i += 2;
        continue;
      }
      if (ch === quote) {
        i += 1;
        break;
      }
      value += ch;
      i += 1;
    }
    return value;
  };
  const parseIdentifier = () => {
    const start = i;
    if (!/[A-Za-z_$]/.test(objectText[i])) return null;
    i += 1;
    while (i < len && /[A-Za-z0-9_$]/.test(objectText[i])) i += 1;
    return objectText.slice(start, i);
  };
  const skipValue = () => {
    let depthBrace = 0;
    let depthBracket = 0;
    let depthParen = 0;
    let inString = null;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (; i < len; i += 1) {
      const ch = objectText[i];
      const next = objectText[i + 1];
      if (inLineComment) {
        if (ch === '\n') inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i += 1;
        }
        continue;
      }
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === inString) {
          inString = null;
        }
        continue;
      }
      if (ch === '/' && next === '/') {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === '\'' || ch === '`') {
        inString = ch;
        continue;
      }
      if (ch === '{') {
        depthBrace += 1;
        continue;
      }
      if (ch === '}') {
        if (depthBrace > 0) {
          depthBrace -= 1;
          continue;
        }
        return;
      }
      if (ch === '[') {
        depthBracket += 1;
        continue;
      }
      if (ch === ']') {
        if (depthBracket > 0) depthBracket -= 1;
        continue;
      }
      if (ch === '(') {
        depthParen += 1;
        continue;
      }
      if (ch === ')') {
        if (depthParen > 0) depthParen -= 1;
        continue;
      }
      if (depthBrace === 0 && depthBracket === 0 && depthParen === 0 && ch === ',') {
        i += 1;
        return;
      }
    }
  };

  while (i < len - 1) {
    skipWhitespace();
    skipComments();
    skipWhitespace();
    if (objectText[i] === '}') break;
    let key = null;
    if (objectText[i] === '"' || objectText[i] === '\'') {
      key = parseString(objectText[i]);
    } else {
      key = parseIdentifier();
    }
    skipWhitespace();
    skipComments();
    skipWhitespace();
    if (!key || objectText[i] !== ':') {
      i += 1;
      continue;
    }
    keys.add(key);
    i += 1;
    skipValue();
  }
  return Array.from(keys);
};

export const scanSourceFiles = async (root, sourceFiles) => {
  const envVarMap = new Map();
  const cliFlagMap = new Map();
  const cliFlagsByFile = new Map();
  const dynamicOptionFiles = new Set();

  for (const filePath of sourceFiles) {
    const relPath = toPosix(path.relative(root, filePath));
    let source = '';
    try {
      source = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') continue;
      throw err;
    }

    const envMatches = source.match(/PAIROFCLEATS_[A-Z0-9_]*[A-Z0-9]/g) || [];
    for (const match of envMatches) {
      if (!envVarMap.has(match)) envVarMap.set(match, new Set());
      envVarMap.get(match).add(relPath);
    }

    const optionObjects = extractOptionObjects(source);
    const fileFlags = new Set();
    for (const obj of optionObjects) {
      extractTopLevelKeys(obj).forEach((key) => fileFlags.add(key));
    }
    const boolFlags = extractStringArray(source, 'BOOLEAN_FLAGS');
    const stringFlags = extractStringArray(source, 'STRING_FLAGS');
    boolFlags.forEach((flag) => fileFlags.add(flag));
    stringFlags.forEach((flag) => fileFlags.add(flag));

    if ((source.includes('.options(') || source.includes('options:')) && fileFlags.size === 0) {
      dynamicOptionFiles.add(relPath);
    }

    if (fileFlags.size) {
      const sorted = Array.from(fileFlags).sort((a, b) => a.localeCompare(b));
      cliFlagsByFile.set(relPath, sorted);
      for (const flag of sorted) {
        if (!cliFlagMap.has(flag)) cliFlagMap.set(flag, new Set());
        cliFlagMap.get(flag).add(relPath);
      }
    }
  }

  return {
    envVarMap,
    cliFlagMap,
    cliFlagsByFile,
    dynamicOptionFiles
  };
};
