#!/usr/bin/env node
import fs from 'node:fs';
import { createFramedJsonRpcParser, writeFramedJsonRpc } from '../../../src/shared/jsonrpc.js';

const counterPath = process.env.POC_LSP_COUNTER;
const tracePath = process.env.POC_LSP_TRACE;
if (counterPath) {
  try {
    fs.appendFileSync(counterPath, 'spawn\n');
  } catch {}
}
const recordEvent = (kind, message) => {
  if (!tracePath) return;
  try {
    fs.appendFileSync(tracePath, `${JSON.stringify({ kind, method: message?.method || null })}\n`);
  } catch {}
};

const args = process.argv.slice(2);
const modeIdx = args.indexOf('--mode');
const mode = modeIdx !== -1 && args[modeIdx + 1] ? args[modeIdx + 1] : 'clangd';
const exitOnShutdown = args.includes('--exit-on-shutdown');
const fragmentSizeIdx = args.indexOf('--fragment-size');
const fragmentSize = fragmentSizeIdx !== -1 && Number.isFinite(Number(args[fragmentSizeIdx + 1]))
  ? Math.max(1, Math.floor(Number(args[fragmentSizeIdx + 1])))
  : 8;

const symbolsByMode = {
  clangd: {
    name: 'add',
    detail: 'int add(int a, int b)',
    kind: 12
  },
  'clangd-compact': {
    name: 'add',
    detail: 'int (int, int)',
    kind: 12
  },
  sourcekit: {
    name: 'greet',
    detail: 'func greet(name: String, count: Int) -> String',
    kind: 12
  },
  pyright: {
    name: 'greet',
    detail: 'def greet(name: str) -> str',
    kind: 12
  },
  'pyright-parameter-shadow': {
    name: 'greet',
    detail: 'def greet(name: str) -> str',
    kind: 12
  },
  java: {
    name: 'add',
    detail: 'int add(int a, int b)',
    kind: 12
  },
  csharp: {
    name: 'Greet',
    detail: 'string Greet(string name)',
    kind: 12
  },
  'csharp-overload': {
    name: 'Greet',
    detail: 'string Greet(string name, int count = 1)',
    kind: 12
  },
  ruby: {
    name: 'greet',
    detail: 'greet(name : String, title = nil) -> String',
    kind: 12
  },
  elixir: {
    name: 'greet',
    detail: 'greet(name :: String.t()) :: String.t()',
    kind: 12
  },
  php: {
    name: 'greet',
    detail: 'string greet(string name)',
    kind: 12
  },
  haskell: {
    name: 'greet',
    detail: 'greet :: Text -> Text',
    kind: 12
  },
  dart: {
    name: 'greet',
    detail: 'String greet(String name)',
    kind: 12
  },
  go: {
    name: 'Add',
    detail: 'func Add(a int, b int) int',
    kind: 12
  },
  rust: {
    name: 'add',
    detail: 'fn add(a: i32, b: i32) -> i32',
    kind: 12
  },
  'rust-diagnostics-proc-macro': {
    name: 'add',
    detail: 'fn add(a: i32, b: i32) -> i32',
    kind: 12
  },
  lua: {
    name: 'greet',
    detail: 'function greet(name: string): string',
    kind: 12
  },
  'lua-requires-workspace-library': {
    name: 'greet',
    detail: 'function greet(name: string): string',
    kind: 12
  },
  zig: {
    name: 'add',
    detail: 'fn add(a: i32, b: i32) i32',
    kind: 12
  },
  'clangd-duplicate-symbols': {
    name: 'add',
    detail: 'add',
    kind: 12
  },
  'clangd-hover-richer': {
    name: 'add',
    detail: 'add',
    hoverDetail: 'int add(int a, int b)',
    kind: 12
  },
  'signature-help': {
    name: 'add',
    detail: 'add',
    hoverDetail: 'add',
    signatureHelpDetail: 'int add(int a, int b)',
    kind: 12
  },
  'stall-signature-help': {
    name: 'add',
    detail: 'add',
    hoverDetail: 'add',
    signatureHelpDetail: 'int add(int a, int b)',
    kind: 12
  },
  'stall-signature-help-two-symbols': {
    name: 'add',
    detail: 'add',
    hoverDetail: 'add',
    signatureHelpDetail: 'int add(int a, int b)',
    kind: 12
  },
  'definition-richer': {
    name: 'add',
    detail: 'add',
    hoverDetail: 'add',
    signatureHelpDetail: 'add',
    kind: 12
  },
  'stall-definition': {
    name: 'add',
    detail: 'add',
    hoverDetail: 'add',
    signatureHelpDetail: 'add',
    kind: 12
  },
  'type-definition-richer': {
    name: 'add',
    detail: 'add',
    hoverDetail: 'add',
    signatureHelpDetail: 'add',
    kind: 12
  },
  'stall-type-definition': {
    name: 'add',
    detail: 'add',
    hoverDetail: 'add',
    signatureHelpDetail: 'add',
    kind: 12
  },
  'references-richer': {
    name: 'add',
    detail: 'add',
    hoverDetail: 'add',
    signatureHelpDetail: 'add',
    kind: 12
  },
  'stall-references': {
    name: 'add',
    detail: 'add',
    hoverDetail: 'add',
    signatureHelpDetail: 'add',
    kind: 12
  }
};

const config = symbolsByMode[mode] || symbolsByMode.clangd;
const pyrightDiagnostic = {
  message: 'Stub pyright diagnostic',
  severity: 2,
  code: 'PYRIGHT_STUB',
  source: 'pyright',
  range: {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 }
  }
};
const documents = new Map();

const resolveInitializeCapabilities = (initializeParams = null) => {
  if (mode === 'yaml-requires-schemastore-off') {
    const schemaStoreEnabled = initializeParams?.initializationOptions?.settings?.yaml?.schemaStore?.enable;
    if (schemaStoreEnabled !== false) {
      return {};
    }
    return {
      documentSymbolProvider: true,
      hoverProvider: true
    };
  }
  if (mode === 'yaml-requires-schemastore-and-schema-map') {
    const yamlSettings = initializeParams?.initializationOptions?.settings?.yaml;
    const schemaStoreEnabled = yamlSettings?.schemaStore?.enable;
    const schemas = yamlSettings?.schemas;
    const hasSchemaMap = schemas && typeof schemas === 'object' && Object.keys(schemas).length > 0;
    if (schemaStoreEnabled !== false || !hasSchemaMap) {
      return {};
    }
    return {
      documentSymbolProvider: true,
      hoverProvider: true
    };
  }
  if (mode === 'lua-requires-workspace-library') {
    const library = initializeParams?.initializationOptions?.settings?.Lua?.workspace?.library;
    if (!Array.isArray(library) || library.length === 0) {
      return {};
    }
    return {
      documentSymbolProvider: true,
      hoverProvider: true
    };
  }
  if (mode === 'no-document-symbol') {
    return {
      hoverProvider: true
    };
  }
  if (mode === 'no-hover') {
    return {
      documentSymbolProvider: true
    };
  }
  if (mode === 'signature-help') {
    return {
      documentSymbolProvider: true,
      hoverProvider: true,
      signatureHelpProvider: true
    };
  }
  if (mode === 'stall-signature-help') {
    return {
      documentSymbolProvider: true,
      hoverProvider: true,
      signatureHelpProvider: true
    };
  }
  if (mode === 'stall-signature-help-two-symbols') {
    return {
      documentSymbolProvider: true,
      hoverProvider: true,
      signatureHelpProvider: true
    };
  }
  if (mode === 'definition-richer') {
    return {
      documentSymbolProvider: true,
      hoverProvider: true,
      signatureHelpProvider: true,
      definitionProvider: true
    };
  }
  if (mode === 'stall-definition') {
    return {
      documentSymbolProvider: true,
      hoverProvider: true,
      signatureHelpProvider: true,
      definitionProvider: true
    };
  }
  if (mode === 'type-definition-richer') {
    return {
      documentSymbolProvider: true,
      hoverProvider: true,
      signatureHelpProvider: true,
      typeDefinitionProvider: true
    };
  }
  if (mode === 'stall-type-definition') {
    return {
      documentSymbolProvider: true,
      hoverProvider: true,
      signatureHelpProvider: true,
      typeDefinitionProvider: true
    };
  }
  if (mode === 'all-capabilities') {
    return {
      documentSymbolProvider: true,
      hoverProvider: true,
      signatureHelpProvider: true,
      definitionProvider: true,
      typeDefinitionProvider: true,
      referencesProvider: true
    };
  }
  if (mode === 'references-richer') {
    return {
      documentSymbolProvider: true,
      hoverProvider: true,
      signatureHelpProvider: true,
      referencesProvider: true
    };
  }
  if (mode === 'stall-references') {
    return {
      documentSymbolProvider: true,
      hoverProvider: true,
      signatureHelpProvider: true,
      referencesProvider: true
    };
  }
  return {
    documentSymbolProvider: true,
    hoverProvider: true
  };
};
const rustProcMacroWarningDiagnostic = {
  message: 'proc-macro expansion is unavailable',
  severity: 2,
  code: 'proc-macro',
  source: 'rust-analyzer',
  range: {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 }
  }
};
const rustErrorDiagnostic = {
  message: 'cannot find function `missing` in this scope',
  severity: 1,
  code: 'E0425',
  source: 'rust-analyzer',
  range: {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 }
  }
};

const writeRawFrame = (bodyBuffer) => {
  const header = Buffer.from(`Content-Length: ${bodyBuffer.length}\r\n\r\n`, 'utf8');
  const frame = Buffer.concat([header, bodyBuffer]);
  if (mode === 'fragmented-responses') {
    for (let i = 0; i < frame.length; i += fragmentSize) {
      process.stdout.write(frame.subarray(i, i + fragmentSize));
    }
    return null;
  }
  return process.stdout.write(frame);
};

const sendMalformedFrame = (bodyText) => {
  writeRawFrame(Buffer.from(String(bodyText || ''), 'utf8'));
};

const send = (payload) => {
  if (mode === 'fragmented-responses') {
    try {
      writeRawFrame(Buffer.from(JSON.stringify(payload), 'utf8'));
      return;
    } catch {}
  }
  const pending = writeFramedJsonRpc(process.stdout, payload);
  if (pending && typeof pending.catch === 'function') {
    pending.catch(() => {});
  }
};

const lineColForIndex = (text, index) => {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split(/\r?\n/);
  const line = Math.max(0, lines.length - 1);
  const character = lines.length ? lines[lines.length - 1].length : 0;
  return { line, character };
};

const buildSymbol = (text) => {
  if (mode === 'pyright') {
    const match = text.match(/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/m);
    if (match) {
      const name = match[1];
      const params = match[2] || '';
      const returnType = match[3] ? ` -> ${match[3].trim()}` : '';
      const detail = `def ${name}(${params})${returnType}`.trim();
      const idx = text.indexOf(name);
      const start = lineColForIndex(text || '', idx >= 0 ? idx : 0);
      const end = lineColForIndex(text || '', idx >= 0 ? idx + name.length : 1);
      return {
        name,
        kind: config.kind,
        detail,
        range: { start, end },
        selectionRange: { start, end }
      };
    }
  }
  const name = config.name;
  const detail = config.detail;
  const idx = text ? text.indexOf(name) : -1;
  const start = lineColForIndex(text || '', idx >= 0 ? idx : 0);
  const end = lineColForIndex(text || '', idx >= 0 ? idx + name.length : 1);
  return {
    name,
    kind: config.kind,
    detail,
    range: { start, end },
    selectionRange: { start, end }
  };
};

const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const respondError = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32601, message } });

const handleRequest = (message) => {
  recordEvent('request', message);
  const { id, method, params } = message;
  if (method === 'initialize') {
    if (mode === 'stall-initialize') {
      return;
    }
    if (mode === 'malformed-initialize') {
      sendMalformedFrame('{"jsonrpc":"2.0","id":1,"result":');
      return;
    }
    if (mode === 'emit-fd-pressure-warning') {
      process.stderr.write('EMFILE: too many open files while probing toolchain\n');
    }
    respond(id, {
      capabilities: resolveInitializeCapabilities(params || null)
    });
    return;
  }
  if (method === 'shutdown') {
    respond(id, null);
    if (exitOnShutdown) {
      setTimeout(() => process.exit(0), 0);
    }
    return;
  }
  if (method === 'textDocument/documentSymbol') {
    if (mode === 'disconnect-on-document-symbol') {
      process.exit(1);
      return;
    }
    if (mode === 'malformed-document-symbol') {
      sendMalformedFrame('{"jsonrpc":"2.0","id":2,"result":');
      return;
    }
    const uri = params?.textDocument?.uri;
    const text = documents.get(uri) || '';
    const symbol = buildSymbol(text);
    if (mode === 'stall-signature-help-two-symbols') {
      const firstName = 'add';
      const secondName = 'sub';
      const firstIndex = text.indexOf(firstName);
      const secondIndex = text.indexOf(secondName);
      const firstStart = lineColForIndex(text || '', firstIndex >= 0 ? firstIndex : 0);
      const firstEnd = lineColForIndex(
        text || '',
        firstIndex >= 0 ? firstIndex + firstName.length : firstName.length
      );
      const secondStart = lineColForIndex(text || '', secondIndex >= 0 ? secondIndex : 0);
      const secondEnd = lineColForIndex(
        text || '',
        secondIndex >= 0 ? secondIndex + secondName.length : secondName.length
      );
      respond(id, [{
        name: firstName,
        kind: 12,
        detail: 'add',
        range: { start: firstStart, end: firstEnd },
        selectionRange: { start: firstStart, end: firstEnd }
      }, {
        name: secondName,
        kind: 12,
        detail: 'sub',
        range: { start: secondStart, end: secondEnd },
        selectionRange: { start: secondStart, end: secondEnd }
      }]);
      return;
    }
    if (mode === 'pyright-parameter-shadow' && symbol) {
      const parameterName = 'name';
      const parameterIndex = text.indexOf(parameterName);
      const parameterStart = lineColForIndex(text || '', parameterIndex >= 0 ? parameterIndex : 0);
      const parameterEnd = lineColForIndex(
        text || '',
        parameterIndex >= 0 ? parameterIndex + parameterName.length : parameterName.length
      );
      respond(id, [{
        ...symbol,
        children: [{
          name: parameterName,
          kind: 13,
          detail: '(parameter) name: str',
          range: { start: parameterStart, end: parameterEnd },
          selectionRange: { start: parameterStart, end: parameterEnd }
        }]
      }]);
      return;
    }
    if (mode === 'clangd-duplicate-symbols' && symbol) {
      respond(id, [symbol, { ...symbol }]);
      return;
    }
    respond(id, symbol ? [symbol] : []);
    return;
  }
  if (method === 'textDocument/hover') {
    if (mode === 'malformed-hover') {
      sendMalformedFrame('{"jsonrpc":"2.0","id":3,"result":');
      return;
    }
    respond(id, {
      contents: { kind: 'plaintext', value: config.hoverDetail || config.detail }
    });
    return;
  }
  if (method === 'textDocument/signatureHelp') {
    if (mode === 'stall-signature-help' || mode === 'stall-signature-help-two-symbols') {
      return;
    }
    const label = String(config.signatureHelpDetail || config.hoverDetail || config.detail || '').trim();
    respond(id, {
      signatures: label ? [{ label }] : [],
      activeSignature: 0,
      activeParameter: 0
    });
    return;
  }
  if (method === 'textDocument/definition') {
    if (mode === 'stall-definition') {
      return;
    }
    const uri = params?.textDocument?.uri || null;
    const text = uri ? (documents.get(uri) || '') : '';
    const lines = text.split(/\r?\n/u);
    const lineText = lines[0] || '';
    respond(id, uri
      ? [{
        uri,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: Math.max(0, lineText.length) }
        }
      }]
      : []);
    return;
  }
  if (method === 'textDocument/typeDefinition') {
    if (mode === 'stall-type-definition') {
      return;
    }
    const uri = params?.textDocument?.uri || null;
    const text = uri ? (documents.get(uri) || '') : '';
    const lines = text.split(/\r?\n/u);
    const lineText = lines[0] || '';
    respond(id, uri
      ? [{
        uri,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: Math.max(0, lineText.length) }
        }
      }]
      : []);
    return;
  }
  if (method === 'textDocument/references') {
    if (mode === 'stall-references') {
      return;
    }
    const uri = params?.textDocument?.uri || null;
    const text = uri ? (documents.get(uri) || '') : '';
    const lines = text.split(/\r?\n/u);
    const lineText = lines[0] || '';
    respond(id, uri
      ? [{
        uri,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: Math.max(0, lineText.length) }
        }
      }]
      : []);
    return;
  }
  respondError(id, `Method not supported: ${method}`);
};

const handleNotification = (message) => {
  recordEvent('notification', message);
  if (!message?.method) return;
  if (message.method === 'textDocument/didOpen') {
    const uri = message.params?.textDocument?.uri;
    const text = message.params?.textDocument?.text || '';
    if (uri) documents.set(uri, text);
    if (uri && mode === 'pyright') {
      send({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics: [pyrightDiagnostic] }
      });
    } else if (uri && mode === 'rust-diagnostics-proc-macro') {
      send({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics: [rustProcMacroWarningDiagnostic, rustErrorDiagnostic] }
      });
    }
  } else if (message.method === 'textDocument/didClose') {
    const uri = message.params?.textDocument?.uri;
    if (uri) documents.delete(uri);
  } else if (message.method === 'exit') {
    process.exit(0);
  }
};

const parser = createFramedJsonRpcParser({
  onMessage: (message) => {
    if (!message || typeof message !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(message, 'id') && message.method) {
      handleRequest(message);
      return;
    }
    handleNotification(message);
  },
  onError: (err) => {
    process.stderr.write(`stub lsp parse error: ${err.message}\n`);
  }
});

process.stdin.on('data', (chunk) => parser.push(chunk));
