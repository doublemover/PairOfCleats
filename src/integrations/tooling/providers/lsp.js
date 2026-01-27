import fs from 'node:fs/promises';
import path from 'node:path';
import { buildLineIndex } from '../../../shared/lines.js';
import { createLspClient, languageIdForFileExt, pathToFileUri } from '../lsp/client.js';
import { rangeToOffsets } from '../lsp/positions.js';
import { flattenSymbols } from '../lsp/symbols.js';
import { createToolingGuard } from './shared.js';
import { resolveVfsDiskPath } from '../../../index/tooling/vfs.js';

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

const normalizeTypeText = (value) => {
  if (!value) return null;
  return String(value).replace(/\s+/g, ' ').trim() || null;
};

const normalizeParamTypes = (paramTypes) => {
  if (!paramTypes || typeof paramTypes !== 'object') return null;
  const output = {};
  for (const [name, entries] of Object.entries(paramTypes)) {
    if (!name) continue;
    if (Array.isArray(entries)) {
      const normalized = entries
        .map((entry) => (typeof entry === 'string' ? { type: entry } : entry))
        .filter((entry) => entry?.type)
        .map((entry) => ({
          type: normalizeTypeText(entry.type),
          confidence: Number.isFinite(entry.confidence) ? entry.confidence : 0.7,
          source: entry.source || 'tooling'
        }))
        .filter((entry) => entry.type);
      if (normalized.length) output[name] = normalized;
      continue;
    }
    if (typeof entries === 'string') {
      const type = normalizeTypeText(entries);
      if (type) output[name] = [{ type, confidence: 0.7, source: 'tooling' }];
    }
  }
  return Object.keys(output).length ? output : null;
};

const findTargetForOffsets = (targets, offsets, nameHint = null) => {
  if (!offsets) return null;
  let best = null;
  let bestRank = -1;
  let bestSpan = Infinity;
  for (const target of targets || []) {
    const range = target?.virtualRange || null;
    if (!range) continue;
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) continue;
    const overlaps = offsets.end >= range.start && offsets.start <= range.end;
    if (!overlaps) continue;
    const contains = offsets.start >= range.start && offsets.end <= range.end;
    const nameMatch = nameHint && target?.symbolHint?.name === nameHint;
    const span = range.end - range.start;
    const rank = (contains ? 2 : 1) + (nameMatch ? 2 : 0);
    if (rank > bestRank || (rank === bestRank && span < bestSpan)) {
      best = target;
      bestRank = rank;
      bestSpan = span;
    }
  }
  return best;
};

const ensureVirtualFile = async (rootDir, doc) => {
  const absPath = resolveVfsDiskPath({ baseDir: rootDir, virtualPath: doc.virtualPath });
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, doc.text || '', 'utf8');
  return absPath;
};

const normalizeUriScheme = (value) => (value === 'poc-vfs' ? 'poc-vfs' : 'file');

const buildVfsUri = (virtualPath) => {
  const encoded = String(virtualPath || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `poc-vfs:///${encoded}`;
};

const resolveDocumentUri = async ({ rootDir, doc, uriScheme }) => {
  if (uriScheme === 'poc-vfs') return buildVfsUri(doc.virtualPath);
  const absPath = await ensureVirtualFile(rootDir, doc);
  return pathToFileUri(absPath);
};

export async function collectLspTypes({
  rootDir,
  documents,
  targets,
  log = () => {},
  cmd,
  args,
  timeoutMs = 15000,
  retries = 2,
  breakerThreshold = 3,
  parseSignature,
  strict = true,
  vfsRoot = null,
  uriScheme = 'file',
  captureDiagnostics = false
}) {
  const docs = Array.isArray(documents) ? documents : [];
  const targetList = Array.isArray(targets) ? targets : [];
  if (!docs.length || !targetList.length) {
    return { byChunkUid: {}, diagnosticsByChunkUid: {}, enriched: 0, diagnosticsCount: 0 };
  }

  const resolvedRoot = vfsRoot || rootDir;
  const resolvedScheme = normalizeUriScheme(uriScheme);
  const targetsByPath = new Map();
  for (const target of targetList) {
    const chunkRef = target?.chunkRef || target?.chunk || null;
    if (!target?.virtualPath || !chunkRef?.chunkUid) continue;
    const list = targetsByPath.get(target.virtualPath) || [];
    list.push({ ...target, chunkRef });
    targetsByPath.set(target.virtualPath, list);
  }

  const diagnosticsByUri = new Map();
  const client = createLspClient({
    cmd,
    args,
    cwd: rootDir,
    log,
    onNotification: (msg) => {
      if (!captureDiagnostics) return;
      if (msg?.method !== 'textDocument/publishDiagnostics') return;
      const uri = msg?.params?.uri;
      const diagnostics = msg?.params?.diagnostics;
      if (!uri || !Array.isArray(diagnostics)) return;
      diagnosticsByUri.set(uri, diagnostics);
    }
  });
  const guard = createToolingGuard({
    name: cmd,
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
    log(`[index] ${cmd} initialize failed: ${err?.message || err}`);
    client.kill();
    return { byChunkUid: {}, diagnosticsByChunkUid: {}, enriched: 0, diagnosticsCount: 0 };
  }

  const byChunkUid = {};
  let enriched = 0;
  const openDocs = new Map();
  for (const doc of docs) {
    const uri = await resolveDocumentUri({ rootDir: resolvedRoot, doc, uriScheme: resolvedScheme });
    const languageId = doc.languageId || languageIdForFileExt(path.extname(doc.virtualPath));
    if (!openDocs.has(doc.virtualPath)) {
      client.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text: doc.text || ''
        }
      });
      openDocs.set(doc.virtualPath, { uri, lineIndex: buildLineIndex(doc.text || '') });
    }

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
      log(`[index] ${cmd} documentSymbol failed (${doc.virtualPath}): ${err?.message || err}`);
      client.notify('textDocument/didClose', { textDocument: { uri } });
      if (guard.isOpen()) break;
      continue;
    }

    const flattened = flattenSymbols(symbols || []);
    if (!flattened.length) {
      client.notify('textDocument/didClose', { textDocument: { uri } });
      continue;
    }

    const lineIndex = openDocs.get(doc.virtualPath)?.lineIndex || buildLineIndex(doc.text || '');
    const docTargets = targetsByPath.get(doc.virtualPath) || [];

    for (const symbol of flattened) {
      const offsets = rangeToOffsets(lineIndex, symbol.selectionRange || symbol.range);
      const target = findTargetForOffsets(docTargets, offsets, symbol.name);
      if (!target) continue;
      let info = parseSignature ? parseSignature(symbol.detail || symbol.name, doc.languageId, symbol.name) : null;
      const hasParamTypes = Object.keys(info?.paramTypes || {}).length > 0;
      if (!info || (!info.returnType && !hasParamTypes)) {
        try {
          const hover = await guard.run(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/hover', {
              textDocument: { uri },
              position: symbol.selectionRange?.start || symbol.range?.start
            }, { timeoutMs: guardTimeout }),
            { label: 'hover', timeoutOverride: 8000 }
          );
          const hoverText = normalizeHoverContents(hover?.contents);
          const hoverInfo = parseSignature ? parseSignature(hoverText, doc.languageId, symbol.name) : null;
          if (hoverInfo) info = hoverInfo;
        } catch {}
      }
      if (!info) continue;

      const chunkUid = target.chunkRef?.chunkUid;
      if (!chunkUid) {
        if (strict) throw new Error('LSP output missing chunkUid.');
        continue;
      }
      byChunkUid[chunkUid] = {
        chunk: target.chunkRef,
        payload: {
          returnType: normalizeTypeText(info.returnType),
          paramTypes: normalizeParamTypes(info.paramTypes),
          signature: normalizeTypeText(info.signature)
        },
        provenance: {
          provider: cmd,
          version: '1.0.0',
          collectedAt: new Date().toISOString()
        }
      };
      enriched += 1;
    }

    client.notify('textDocument/didClose', { textDocument: { uri } });
  }

  const diagnosticsByChunkUid = {};
  let diagnosticsCount = 0;
  if (captureDiagnostics && diagnosticsByUri.size) {
    for (const doc of docs) {
      const fallbackUri = resolvedScheme === 'poc-vfs'
        ? buildVfsUri(doc.virtualPath)
        : pathToFileUri(resolveVfsDiskPath({ baseDir: resolvedRoot, virtualPath: doc.virtualPath }));
      const uri = openDocs.get(doc.virtualPath)?.uri || fallbackUri;
      const diagnostics = diagnosticsByUri.get(uri) || [];
      if (!diagnostics.length) continue;
      const lineIndex = buildLineIndex(doc.text || '');
      const docTargets = targetsByPath.get(doc.virtualPath) || [];
      for (const diag of diagnostics) {
        const offsets = rangeToOffsets(lineIndex, diag.range);
        const target = findTargetForOffsets(docTargets, offsets);
        if (!target?.chunkRef?.chunkUid) continue;
        const chunkUid = target.chunkRef.chunkUid;
        const existing = diagnosticsByChunkUid[chunkUid] || [];
        existing.push(diag);
        diagnosticsByChunkUid[chunkUid] = existing;
        diagnosticsCount += 1;
      }
    }
  }

  await client.shutdownAndExit();
  client.kill();
  return { byChunkUid, diagnosticsByChunkUid, enriched, diagnosticsCount };
}
