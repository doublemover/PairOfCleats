import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const { createFramedJsonRpcParser, getJsonRpcWriter } = await import('../../../src/shared/jsonrpc.js');
const { runSemanticDetail } = await import('../../../src/integrations/tooling/semantic-detail.js');
const { runSemanticTrace } = await import('../../../src/integrations/tooling/semantic-trace.js');
const { runSemanticFind } = await import('../../../src/integrations/tooling/semantic-find.js');
const { runSemanticExplain } = await import('../../../src/integrations/tooling/semantic-explain.js');

// Private child transport, deliberately not a CLI, scheduler, or cursor store.
// The canonical runners retain their own cursor/query/generation policy.
const runners = { 'semantic.detail': runSemanticDetail, 'semantic.trace': runSemanticTrace,
  'semantic.find': runSemanticFind, 'semantic.explain': runSemanticExplain };
const runner = runners[process.argv[2]];
if (!runner) throw new Error('Unsupported native semantic worker.');
const writer = getJsonRpcWriter(process.stdout);
let original = null, cursor = null, active = null, closing = false;
const send = async payload => {
  if (Buffer.byteLength(JSON.stringify(payload)) > 768 * 1024) throw Object.assign(new Error('Page exceeds native output bound.'),
    { code: 'ERR_TUI_SEMANTIC_OUTPUT' });
  await writer.write(payload);
};
const handle = async message => {
  if (message?.jsonrpc !== '2.0') { process.exitCode = 1; process.stdin.destroy(); return; }
  if (message.method === '$/cancelRequest') {
    if (active?.id === message.params?.id) active.controller.abort();
    return;
  }
  const id = message.id;
  if (!Number.isSafeInteger(id) || closing) return;
  if (active) { await send({ jsonrpc: '2.0', id, error: { code: -32001, message: 'Worker busy.' } }); return; }
  const controller = new AbortController();
  active = { id, controller };
  try {
    if (message.method === 'page.open' && original === null && message.params
      && typeof message.params === 'object' && !message.params.cursor) {
      original = structuredClone(message.params);
    } else if (message.method !== 'page.next' || !original || !cursor
      || Object.keys(message.params || {}).length !== 0) {
      throw Object.assign(new Error('Invalid continuation state.'), { code: 'ERR_TUI_SEMANTIC_CONTINUATION' });
    }
    const result = await runner({ ...original, cursor }, { signal: controller.signal });
    if (controller.signal.aborted) throw Object.assign(new Error('Cancelled.'), { code: 'ABORT_ERR' });
    // Never accept a query, cursor or generation replacement on continuation.
    const nextCursor = result.cursor || null;
    await send({ jsonrpc: '2.0', id, result: { page: { ...result, cursor: null }, hasMore: Boolean(nextCursor) } });
    cursor = nextCursor;
  } catch (error) {
    cursor = null;
    await send({ jsonrpc: '2.0', id, error: { code: -32000,
      message: 'Semantic page did not complete.', data: { code: String(error.code || 'ERR_TUI_SEMANTIC_PAGE').slice(0, 80) } } });
  } finally { active = null; if (closing) writer.close(); }
};
const parser = createFramedJsonRpcParser({ maxBufferBytes: 768 * 1024 + 8192, maxHeaderBytes: 8192,
  maxMessageBytes: 768 * 1024, onMessage: message => { handle(message).catch(() => {
    closing = true; active?.controller.abort(); process.exitCode = 1; process.stdin.destroy(); writer.close();
  }); }, onError: () => { closing = true; active?.controller.abort(); process.exitCode = 1; process.stdin.destroy(); writer.close(); } });
process.stdin.on('data', chunk => parser.push(chunk));
process.stdin.on('end', () => { closing = true; active?.controller.abort(); parser.dispose(); if (!active) writer.close(); });
