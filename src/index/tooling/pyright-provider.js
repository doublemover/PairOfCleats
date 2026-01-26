import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execaSync } from 'execa';
import { buildLineIndex } from '../../shared/lines.js';
import { createLspClient, languageIdForFileExt, pathToFileUri } from '../../integrations/tooling/lsp/client.js';
import { rangeToOffsets } from '../../integrations/tooling/lsp/positions.js';
import { flattenSymbols } from '../../integrations/tooling/lsp/symbols.js';
import { createToolingEntry, createToolingGuard, uniqueTypes } from '../../integrations/tooling/providers/shared.js';
import { resolveToolRoot } from '../../../tools/dict-utils.js';
import { parsePythonSignature } from './signature-parse/python.js';

export const PYTHON_EXTS = ['.py', '.pyi'];

const candidateNames = (name) => {
  if (process.platform === 'win32') {
    return [`${name}.cmd`, `${name}.exe`, name];
  }
  return [name];
};

const findBinaryInDirs = (name, dirs) => {
  const candidates = candidateNames(name);
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (fsSync.existsSync(full)) return full;
    }
  }
  return null;
};

const shouldUseShell = (cmd) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);

const canRunPyright = (cmd) => {
  if (!cmd) return false;
  if (fsSync.existsSync(cmd)) return true;
  for (const args of [['--version'], ['--help']]) {
    try {
      const result = execaSync(cmd, args, {
        stdio: 'ignore',
        shell: shouldUseShell(cmd),
        reject: false
      });
      if (typeof result.exitCode === 'number') return true;
    } catch {}
  }
  return false;
};

const resolveCommand = (cmd, rootDir, toolingConfig) => {
  if (!cmd) return cmd;
  if (path.isAbsolute(cmd) || cmd.includes(path.sep)) return cmd;
  const testing = process.env.PAIROFCLEATS_TESTING === '1' || process.env.PAIROFCLEATS_TESTING === 'true';
  if (testing) {
    const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const pathFound = findBinaryInDirs(cmd, pathEntries);
    if (pathFound) return pathFound;
  }
  const toolRoot = resolveToolRoot();
  const repoBin = path.join(rootDir, 'node_modules', '.bin');
  const toolBin = toolRoot ? path.join(toolRoot, 'node_modules', '.bin') : null;
  const toolingBin = toolingConfig?.dir
    ? path.join(toolingConfig.dir, 'node', 'node_modules', '.bin')
    : null;
  const found = findBinaryInDirs(cmd, [repoBin, toolBin, toolingBin].filter(Boolean));
  if (found) return found;
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const pathFound = findBinaryInDirs(cmd, pathEntries);
  return pathFound || cmd;
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

const findChunkForOffsets = (chunks, offsets) => {
  if (!offsets) return null;
  let best = null;
  let bestRank = -1;
  let bestSpan = Infinity;
  for (const chunk of chunks || []) {
    if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) continue;
    const overlaps = offsets.end >= chunk.start && offsets.start <= chunk.end;
    if (!overlaps) continue;
    const contains = offsets.start >= chunk.start && offsets.end <= chunk.end;
    const span = chunk.end - chunk.start;
    const rank = contains ? 2 : 1;
    if (rank > bestRank || (rank === bestRank && span < bestSpan)) {
      best = chunk;
      bestRank = rank;
      bestSpan = span;
    }
  }
  return best;
};

const normalizeDiagnostic = (diag) => {
  if (!diag || typeof diag !== 'object') return null;
  const message = typeof diag.message === 'string' ? diag.message.trim() : '';
  if (!message) return null;
  const normalizePos = (pos) => ({
    line: Number.isFinite(pos?.line) ? pos.line + 1 : null,
    column: Number.isFinite(pos?.character) ? pos.character + 1 : null
  });
  return {
    message,
    severity: Number.isFinite(diag.severity) ? diag.severity : null,
    code: diag.code ?? null,
    source: typeof diag.source === 'string' ? diag.source : 'pyright',
    range: diag.range
      ? { start: normalizePos(diag.range.start), end: normalizePos(diag.range.end) }
      : null
  };
};

export async function collectPyrightTypes({
  rootDir,
  chunksByFile,
  fileTextByFile = null,
  log = () => {},
  cmd = 'pyright-langserver',
  args = ['--stdio'],
  timeoutMs = 15000,
  retries = 2,
  breakerThreshold = 3,
  toolingConfig = null
}) {
  const files = Array.from(chunksByFile.keys());
  if (!files.length) {
    return {
      typesByChunk: new Map(),
      diagnosticsByChunk: new Map(),
      enriched: 0,
      diagnosticsCount: 0,
      cmd,
      args
    };
  }

  let resolvedCmd = resolveCommand(cmd, rootDir, toolingConfig);
  const resolvedArgs = Array.isArray(args) ? args : [];
  let useShell = shouldUseShell(resolvedCmd);
  if (!canRunPyright(resolvedCmd)) {
    const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const pathCandidate = findBinaryInDirs(cmd, pathEntries);
    if (pathCandidate && pathCandidate !== resolvedCmd && canRunPyright(pathCandidate)) {
      resolvedCmd = pathCandidate;
      useShell = shouldUseShell(resolvedCmd);
    } else {
    log('[index] pyright-langserver not detected; skipping tooling-based types.');
    return {
      typesByChunk: new Map(),
      diagnosticsByChunk: new Map(),
      enriched: 0,
      diagnosticsCount: 0,
      cmd: resolvedCmd,
      args: resolvedArgs
    };
    }
  }

  const diagnosticsByUri = new Map();
  const client = createLspClient({
    cmd: resolvedCmd,
    args: resolvedArgs,
    cwd: rootDir,
    log,
    shell: useShell,
    onNotification: (message) => {
      if (message?.method !== 'textDocument/publishDiagnostics') return;
      const uri = message.params?.uri;
      if (!uri) return;
      const diagnostics = Array.isArray(message.params?.diagnostics)
        ? message.params.diagnostics
        : [];
      diagnosticsByUri.set(uri, diagnostics);
    }
  });
  const guard = createToolingGuard({
    name: 'pyright',
    timeoutMs,
    retries,
    breakerThreshold,
    log
  });
  const rootUri = pathToFileUri(rootDir);
  try {
    await guard.run(({ timeoutMs: guardTimeout }) => client.initialize({
      rootUri,
      capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
      timeoutMs: guardTimeout
    }), { label: 'initialize' });
  } catch (err) {
    log(`[index] pyright initialize failed: ${err?.message || err}`);
    client.kill();
    return {
      typesByChunk: new Map(),
      diagnosticsByChunk: new Map(),
      enriched: 0,
      diagnosticsCount: 0,
      cmd: resolvedCmd,
      args: resolvedArgs
    };
  }

  const typesByChunk = new Map();
  const fileText = fileTextByFile instanceof Map ? fileTextByFile : new Map();
  let enriched = 0;
  for (const file of files) {
    const absPath = path.join(rootDir, file);
    let text = typeof fileText.get(file) === 'string' ? fileText.get(file) : null;
    if (typeof text !== 'string') {
      try {
        text = await fs.readFile(absPath, 'utf8');
      } catch {
        continue;
      }
      fileText.set(file, text);
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
      symbols = await guard.run(
        ({ timeoutMs: guardTimeout }) => client.request(
          'textDocument/documentSymbol',
          { textDocument: { uri } },
          { timeoutMs: guardTimeout }
        ),
        { label: 'documentSymbol' }
      );
    } catch (err) {
      log(`[index] pyright documentSymbol failed (${file}): ${err?.message || err}`);
      client.notify('textDocument/didClose', { textDocument: { uri } });
      if (guard.isOpen()) break;
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
      const target = findChunkForOffsets(fileChunks, offsets);
      if (!target) continue;
      let info = parsePythonSignature(symbol.detail || symbol.name);
      const hasParamTypes = Object.keys(info?.paramTypes || {}).length > 0;
      if (!info || !info.returnType || !hasParamTypes) {
        try {
          const hover = await guard.run(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/hover', {
              textDocument: { uri },
              position: symbol.selectionRange?.start || symbol.range?.start
            }, { timeoutMs: guardTimeout }),
            { label: 'hover', timeoutOverride: 8000 }
          );
          const hoverText = normalizeHoverContents(hover?.contents);
          const hoverInfo = parsePythonSignature(hoverText);
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

  const diagnosticsByChunk = new Map();
  let diagnosticsCount = 0;
  for (const [file, chunks] of chunksByFile.entries()) {
    const absPath = path.join(rootDir, file);
    const uri = pathToFileUri(absPath);
    const diagnostics = diagnosticsByUri.get(uri) || [];
    if (!diagnostics.length) continue;
    let text = fileText.get(file);
    if (typeof text !== 'string') {
      try {
        text = await fs.readFile(absPath, 'utf8');
      } catch {
        text = '';
      }
      fileText.set(file, text);
    }
    if (!text) continue;
    const lineIndex = buildLineIndex(text);
    for (const diag of diagnostics) {
      const normalized = normalizeDiagnostic(diag);
      if (!normalized) continue;
      const offsets = rangeToOffsets(lineIndex, diag.range);
      const target = findChunkForOffsets(chunks, offsets);
      if (!target) continue;
      const key = `${target.file}::${target.name}`;
      const existing = diagnosticsByChunk.get(key) || [];
      existing.push(normalized);
      diagnosticsByChunk.set(key, existing);
      diagnosticsCount += 1;
    }
  }

  await client.shutdownAndExit();
  client.kill();
  return {
    typesByChunk,
    diagnosticsByChunk,
    enriched,
    diagnosticsCount,
    cmd: resolvedCmd,
    args: resolvedArgs
  };
}
