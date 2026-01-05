import fs from 'node:fs/promises';
import path from 'node:path';
import { buildLineIndex } from '../../../shared/lines.js';
import { createLspClient, languageIdForFileExt, pathToFileUri } from '../lsp/client.js';
import { rangeToOffsets } from '../lsp/positions.js';
import { flattenSymbols } from '../lsp/symbols.js';
import { createToolingEntry, uniqueTypes } from './shared.js';

const splitParams = (value) => {
  if (!value) return [];
  const params = [];
  let current = '';
  let depthAngle = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  for (const ch of value) {
    if (ch === '<') depthAngle += 1;
    if (ch === '>' && depthAngle > 0) depthAngle -= 1;
    if (ch === '(') depthParen += 1;
    if (ch === ')' && depthParen > 0) depthParen -= 1;
    if (ch === '[') depthBracket += 1;
    if (ch === ']' && depthBracket > 0) depthBracket -= 1;
    if (ch === '{') depthBrace += 1;
    if (ch === '}' && depthBrace > 0) depthBrace -= 1;
    if (ch === ',' && depthAngle === 0 && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      if (current.trim()) params.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) params.push(current.trim());
  return params;
};

const normalizeHoverContents = (contents) => {
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents.map((entry) => normalizeHoverContents(entry)).filter(Boolean).join('\n');
  }
  if (typeof contents === 'object') {
    if (typeof contents.value === 'string') return contents.value;
    if (typeof contents.language === 'string' && typeof contents.value === 'string') return contents.value;
  }
  return '';
};

const extractSwiftSignature = (detail) => {
  const open = detail.indexOf('(');
  const close = detail.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return null;
  const signature = detail.trim();
  const paramsText = detail.slice(open + 1, close).trim();
  const after = detail.slice(close + 1).trim();
  const arrowMatch = after.match(/->\s*(.+)$/);
  const returnType = arrowMatch ? arrowMatch[1].trim() : null;
  const paramTypes = {};
  const paramNames = [];
  for (const part of splitParams(paramsText)) {
    const cleaned = part.replace(/=.*/g, '').trim();
    if (!cleaned) continue;
    const segments = cleaned.split(':');
    if (segments.length < 2) continue;
    const nameTokens = segments[0].trim().split(/\s+/).filter(Boolean);
    let name = nameTokens[nameTokens.length - 1] || '';
    if (name === '_' && nameTokens.length > 1) {
      name = nameTokens[nameTokens.length - 2] || '';
    }
    const type = segments.slice(1).join(':').trim();
    if (!name || !type) continue;
    paramNames.push(name);
    paramTypes[name] = type;
  }
  return { signature, returnType, paramTypes, paramNames };
};

const extractObjcSignature = (detail) => {
  if (!detail.includes(':')) return null;
  const signature = detail.trim();
  const returnMatch = signature.match(/\(([^)]+)\)\s*[^:]+/);
  const returnType = returnMatch ? returnMatch[1].trim() : null;
  const paramTypes = {};
  const paramNames = [];
  const paramRe = /:\s*\(([^)]+)\)\s*([A-Za-z_][\w]*)/g;
  let match;
  while ((match = paramRe.exec(signature)) !== null) {
    const type = match[1]?.trim();
    const name = match[2]?.trim();
    if (!type || !name) continue;
    paramNames.push(name);
    paramTypes[name] = type;
  }
  if (!returnType && !paramNames.length) return null;
  return { signature, returnType, paramTypes, paramNames };
};

const extractClikeSignature = (detail, symbolName) => {
  const open = detail.indexOf('(');
  const close = detail.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return null;
  const signature = detail.trim();
  const before = detail.slice(0, open).trim();
  const paramsText = detail.slice(open + 1, close).trim();
  let returnType = null;
  if (before) {
    let idx = -1;
    if (symbolName) {
      idx = before.lastIndexOf(symbolName);
      if (idx === -1) idx = before.lastIndexOf(`::${symbolName}`);
      if (idx !== -1 && before[idx] === ':' && before[idx - 1] === ':') idx -= 1;
    }
    returnType = idx > 0 ? before.slice(0, idx).trim() : before;
    returnType = returnType.replace(/\b(static|inline|constexpr|virtual|extern|friend)\b/g, '').trim();
  }
  const paramTypes = {};
  const paramNames = [];
  for (const part of splitParams(paramsText)) {
    const cleaned = part.trim();
    if (!cleaned || cleaned === 'void' || cleaned === '...') continue;
    const noDefault = cleaned.split('=').shift().trim();
    const nameMatch = noDefault.match(/([A-Za-z_][\w]*)\s*(?:\[[^\]]*\])?$/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const type = noDefault.slice(0, nameMatch.index).trim();
    if (!name || !type) continue;
    paramNames.push(name);
    paramTypes[name] = type;
  }
  return { signature, returnType, paramTypes, paramNames };
};

const extractSignatureInfo = (detail, languageId, symbolName) => {
  if (!detail || typeof detail !== 'string') return null;
  const trimmed = detail.trim();
  if (!trimmed) return null;
  if (languageId === 'swift') return extractSwiftSignature(trimmed);
  if (languageId === 'objective-c' || languageId === 'objective-cpp') {
    const objc = extractObjcSignature(trimmed);
    if (objc) return objc;
  }
  if (languageId === 'c' || languageId === 'cpp' || languageId === 'objective-c' || languageId === 'objective-cpp') {
    return extractClikeSignature(trimmed, symbolName);
  }
  return null;
};

const findChunkForOffsets = (chunks, start, end) => {
  let best = null;
  let bestSpan = Infinity;
  for (const chunk of chunks || []) {
    if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) continue;
    if (start >= chunk.start && end <= chunk.end) {
      const span = chunk.end - chunk.start;
      if (span < bestSpan) {
        best = chunk;
        bestSpan = span;
      }
    }
  }
  return best;
};

export async function collectLspTypes({
  rootDir,
  chunksByFile,
  log,
  cmd,
  args,
  timeoutMs = 15000
}) {
  const files = Array.from(chunksByFile.keys());
  if (!files.length) return { typesByChunk: new Map(), enriched: 0 };

  const client = createLspClient({ cmd, args, cwd: rootDir, log });
  const rootUri = pathToFileUri(rootDir);
  try {
    await client.initialize({
      rootUri,
      capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } }
    });
  } catch (err) {
    log(`[index] ${cmd} initialize failed: ${err?.message || err}`);
    client.kill();
    return { typesByChunk: new Map(), enriched: 0 };
  }

  const typesByChunk = new Map();
  let enriched = 0;
  for (const file of files) {
    const absPath = path.join(rootDir, file);
    let text = '';
    try {
      text = await fs.readFile(absPath, 'utf8');
    } catch {
      continue;
    }
    const uri = pathToFileUri(absPath);
    const languageId = languageIdForFileExt(path.extname(file));
    client.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text
      }
    });

    let symbols = null;
    try {
      symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } }, { timeoutMs });
    } catch (err) {
      log(`[index] ${cmd} documentSymbol failed (${file}): ${err?.message || err}`);
      client.notify('textDocument/didClose', { textDocument: { uri } });
      continue;
    }
    const flattened = flattenSymbols(symbols || []);
    if (!flattened.length) {
      client.notify('textDocument/didClose', { textDocument: { uri } });
      continue;
    }

    const lineIndex = buildLineIndex(text);
    const fileChunks = chunksByFile.get(file) || [];

    for (const symbol of flattened) {
      const offsets = rangeToOffsets(lineIndex, symbol.selectionRange || symbol.range);
      const target = findChunkForOffsets(fileChunks, offsets.start, offsets.end);
      if (!target) continue;
      let info = extractSignatureInfo(symbol.detail, languageId, symbol.name);
      if (!info || (!info.returnType && !Object.keys(info.paramTypes || {}).length)) {
        try {
          const hover = await client.request('textDocument/hover', {
            textDocument: { uri },
            position: symbol.selectionRange?.start || symbol.range?.start
          }, { timeoutMs: 8000 });
          const hoverText = normalizeHoverContents(hover?.contents);
          const hoverInfo = extractSignatureInfo(hoverText, languageId, symbol.name);
          if (hoverInfo) info = hoverInfo;
        } catch {}
      }
      if (!info) continue;

      const key = `${target.file}::${target.name}`;
      const entry = typesByChunk.get(key) || createToolingEntry();
      if (info.signature && !entry.signature) entry.signature = info.signature;
      if (info.paramNames?.length && (!entry.paramNames || !entry.paramNames.length)) {
        entry.paramNames = info.paramNames.slice();
      }
      if (info.returnType) entry.returns = uniqueTypes([...(entry.returns || []), info.returnType]);
      if (info.paramTypes && Object.keys(info.paramTypes).length) {
        for (const [name, type] of Object.entries(info.paramTypes)) {
          if (!name || !type) continue;
          const existing = entry.params?.[name] || [];
          entry.params[name] = uniqueTypes([...(existing || []), type]);
        }
      }
      typesByChunk.set(key, entry);
      enriched += 1;
    }

    client.notify('textDocument/didClose', { textDocument: { uri } });
  }

  await client.shutdownAndExit();
  client.kill();
  return { typesByChunk, enriched };
}
