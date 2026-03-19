#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildLineIndex } from '../../../src/shared/lines.js';
import { buildTargetLookupIndex } from '../../../src/integrations/tooling/providers/lsp/target-index.js';
import {
  createEmptyHoverMetricsResult,
  processDocumentTypes
} from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

const docText = 'function add(a, b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.js#seg:semantic-inlay.js';
const chunkUid = 'ck64:v1:test:src/sample.js:semantic-inlay';
const addIndex = docText.indexOf('add');
const aIndex = docText.indexOf('a', addIndex + 3);
const bIndex = docText.indexOf('b', aIndex + 1);
const closeParenIndex = docText.indexOf(')', addIndex);

const lineIndexFactory = (text) => buildLineIndex(text);
const target = {
  chunkRef: {
    docId: 0,
    chunkUid,
    chunkId: 'chunk_semantic_inlay',
    file: 'src/sample.js',
    segmentUid: null,
    segmentId: null,
    range: { start: 0, end: docText.length }
  },
  virtualPath,
  virtualRange: { start: 0, end: docText.length },
  symbolHint: { name: 'add', kind: 'function' }
};
const targetIndexesByPath = new Map([[virtualPath, buildTargetLookupIndex([target])]]);
const byChunkUid = {};
const hoverFileStats = new Map();
const hoverLatencyMs = [];
const hoverMetrics = createEmptyHoverMetricsResult();

const identityLimiter = async (fn) => await fn();
const mockClient = {
  notify() {},
  async request(method) {
    if (method === 'textDocument/documentSymbol') {
      return [{
        name: 'add',
        kind: 12,
        detail: 'add',
        range: {
          start: { line: 0, character: addIndex },
          end: { line: 0, character: addIndex + 3 }
        },
        selectionRange: {
          start: { line: 0, character: addIndex },
          end: { line: 0, character: addIndex + 3 }
        }
      }];
    }
    if (method === 'textDocument/semanticTokens/full') {
      return {
        data: [
          0, addIndex, 3, 2, 1,
          0, aIndex - addIndex, 1, 3, 1,
          0, bIndex - aIndex, 1, 3, 1
        ]
      };
    }
    if (method === 'textDocument/inlayHint') {
      return [{
        position: { line: 0, character: aIndex },
        label: 'a: integer',
        kind: 1
      }, {
        position: { line: 0, character: bIndex },
        label: 'b: integer',
        kind: 1
      }, {
        position: { line: 0, character: closeParenIndex },
        label: '-> integer',
        kind: 1
      }];
    }
    throw new Error(`unexpected request ${method}`);
  }
};

await processDocumentTypes({
  doc: {
    virtualPath,
    text: docText,
    languageId: 'javascript',
    docHash: 'hash-semantic-inlay'
  },
  cmd: 'semantic-inlay-test',
  client: mockClient,
  guard: {
    isOpen: () => false,
    run: async (fn) => await fn({ timeoutMs: 5000 }),
    getState: () => ({})
  },
  guardRun: async (fn) => await fn({ timeoutMs: 5000 }),
  log: () => {},
  strict: true,
  parseSignature: () => null,
  lineIndexFactory,
  uri: 'poc-vfs://semantic-inlay.js',
  legacyUri: null,
  languageId: 'javascript',
  openDocs: new Map(),
  targetIndexesByPath,
  byChunkUid,
  signatureParseCache: new Map(),
  hoverEnabled: false,
  semanticTokensEnabled: true,
  signatureHelpEnabled: false,
  inlayHintsEnabled: true,
  definitionEnabled: false,
  typeDefinitionEnabled: false,
  referencesEnabled: false,
  docPathPolicy: null,
  hoverRequireMissingReturn: true,
  resolvedHoverKinds: null,
  resolvedHoverMaxPerFile: 2,
  resolvedHoverDisableAfterTimeouts: 2,
  resolvedHoverTimeout: 5000,
  resolvedSignatureHelpTimeout: 5000,
  resolvedDefinitionTimeout: 5000,
  resolvedTypeDefinitionTimeout: 5000,
  resolvedReferencesTimeout: 5000,
  resolvedDocumentSymbolTimeout: 5000,
  hoverLimiter: identityLimiter,
  signatureHelpLimiter: identityLimiter,
  definitionLimiter: identityLimiter,
  typeDefinitionLimiter: identityLimiter,
  referencesLimiter: identityLimiter,
  requestCacheEntries: new Map(),
  requestCachePersistedKeys: new Set(),
  requestCacheMetrics: {
    providerId: 'semantic-inlay-test',
    hits: 0,
    misses: 0,
    memoryHits: 0,
    persistedHits: 0,
    negativeHits: 0,
    writes: 0,
    byKind: Object.create(null)
  },
  markRequestCacheDirty: () => {},
  requestBudgetControllers: {
    documentSymbol: { tryReserve: () => true },
    semanticTokens: { tryReserve: () => true },
    inlayHints: { tryReserve: () => true }
  },
  requestCacheContext: {
    providerId: 'clangd',
    providerVersion: '1.0.0',
    workspaceKey: 'repo-root'
  },
  semanticTokensLegend: {
    tokenTypes: ['namespace', 'class', 'function', 'parameter'],
    tokenModifiers: ['declaration']
  },
  hoverControl: { disabledGlobal: false },
  documentSymbolControl: { disabled: false },
  hoverFileStats,
  hoverLatencyMs,
  hoverMetrics,
  symbolProcessingConcurrency: 4,
  softDeadlineAt: null,
  positionEncoding: 'utf-16',
  checks: [],
  checkFlags: Object.create(null),
  abortSignal: null
});

const entry = byChunkUid[chunkUid] || null;
assert.ok(entry, 'expected tooling entry for semantic/inlay mode');
assert.equal(entry.payload?.returnType, 'number', 'expected inlay return type enrichment');
assert.equal(entry.payload?.paramTypes?.a?.[0]?.type, 'number', 'expected inlay param type enrichment');
assert.equal(entry.payload?.paramTypes?.b?.[0]?.type, 'number', 'expected second inlay param type enrichment');
assert.equal(entry.symbolRef?.kind, 'function', 'expected semantic token class to feed symbolRef kind');
assert.equal(entry.provenance?.stages?.semanticTokens?.succeeded, true, 'expected semantic token stage provenance');
assert.equal(entry.provenance?.stages?.inlayHints?.succeeded, true, 'expected inlay-hint stage provenance');
assert.equal(Number(hoverMetrics?.semanticTokensRequested || 0) >= 1, true, 'expected semantic token runtime metric');
assert.equal(Number(hoverMetrics?.inlayHintsRequested || 0) >= 1, true, 'expected inlay-hint runtime metric');

console.log('LSP semantic tokens and inlay hints test passed');
