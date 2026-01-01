import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildLineIndex } from '../../shared/lines.js';
import { createLspClient, pathToFileUri } from '../../tooling/lsp/client.js';
import { rangeToOffsets } from '../../tooling/lsp/positions.js';
import { flattenSymbols } from '../../tooling/lsp/symbols.js';
import { createToolingEntry, uniqueTypes } from '../../tooling/providers/shared.js';
import { parseSwiftSignature } from './signature-parse/swift.js';

export const SWIFT_EXTS = ['.swift'];

const leafName = (value) => {
  if (!value) return null;
  const parts = String(value).split(/::|\./).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : value;
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

const findChunkForOffsets = (chunks, offsets, symbolName) => {
  if (!offsets) return null;
  const symbolLeaf = leafName(symbolName);
  let best = null;
  let bestRank = -1;
  let bestSpan = Infinity;
  for (const chunk of chunks || []) {
    if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) continue;
    const overlaps = offsets.end >= chunk.start && offsets.start <= chunk.end;
    if (!overlaps) continue;
    const contains = offsets.start >= chunk.start && offsets.end <= chunk.end;
    const nameMatch = symbolLeaf && leafName(chunk.name) === symbolLeaf;
    const span = chunk.end - chunk.start;
    const rank = (contains ? 2 : 1) + (nameMatch ? 2 : 0);
    if (rank > bestRank || (rank === bestRank && span < bestSpan)) {
      best = chunk;
      bestRank = rank;
      bestSpan = span;
    }
  }
  return best;
};

const shouldUseShell = (cmd) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);

const canRunSourcekit = (cmd) => {
  try {
    const result = spawnSync(cmd, ['--help'], { stdio: 'ignore', shell: shouldUseShell(cmd) });
    if (result.error) return false;
    if (typeof result.status === 'number') return result.status === 0;
    return true;
  } catch {
    return false;
  }
};

const resolveCommand = (cmd) => {
  if (process.platform !== 'win32') return cmd;
  const lowered = String(cmd || '').toLowerCase();
  if (lowered.endsWith('.exe') || lowered.endsWith('.cmd') || lowered.endsWith('.bat')) return cmd;
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const ext of ['.exe', '.cmd', '.bat']) {
    for (const dir of pathEntries) {
      const candidate = path.join(dir, `${cmd}${ext}`);
      if (fsSync.existsSync(candidate)) return candidate;
    }
  }
  return cmd;
};

export async function collectSourcekitTypes({
  rootDir,
  chunksByFile,
  log = () => {},
  cmd = 'sourcekit-lsp',
  args = [],
  timeoutMs = 15000
}) {
  const resolvedCmd = resolveCommand(cmd);
  const useShell = shouldUseShell(resolvedCmd);
  const files = Array.from(chunksByFile.keys());
  if (!files.length) return { typesByChunk: new Map(), enriched: 0 };

  if (!canRunSourcekit(resolvedCmd)) {
    log('[index] sourcekit-lsp not detected; skipping tooling-based types.');
    return { typesByChunk: new Map(), enriched: 0 };
  }

  const client = createLspClient({ cmd: resolvedCmd, args, cwd: rootDir, log, shell: useShell });
  const rootUri = pathToFileUri(rootDir);
  try {
    await client.initialize({
      rootUri,
      capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } }
    });
  } catch (err) {
    log(`[index] sourcekit-lsp initialize failed: ${err?.message || err}`);
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
    client.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'swift',
        version: 1,
        text
      }
    });

    let symbols = null;
    try {
      symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } }, { timeoutMs });
    } catch (err) {
      log(`[index] sourcekit-lsp documentSymbol failed (${file}): ${err?.message || err}`);
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
      const target = findChunkForOffsets(fileChunks, offsets, symbol.name);
      if (!target) continue;
      let info = parseSwiftSignature(symbol.detail);
      if (!info || (!info.returnType && !Object.keys(info.paramTypes || {}).length)) {
        try {
          const hover = await client.request('textDocument/hover', {
            textDocument: { uri },
            position: symbol.selectionRange?.start || symbol.range?.start
          }, { timeoutMs: 8000 });
          const hoverText = normalizeHoverContents(hover?.contents);
          const hoverInfo = parseSwiftSignature(hoverText);
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
      if (info.returnType) {
        entry.returns = uniqueTypes([...(entry.returns || []), info.returnType]);
      }
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
