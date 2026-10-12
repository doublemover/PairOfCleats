import { digest, historyError } from './common.js';

const fail = (message) => historyError('ERR_INFERENCE_HISTORY_GGUF_QUALIFICATION', message);
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const commit = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const label = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200;
const fields = [
  'schema', 'endpoint', 'alias', 'instanceId', 'deviceIdentifier', 'ggufSha256',
  'tokenizerSha256', 'engineBuild', 'engineCommit', 'supportEvidenceSha256', 'precision',
  'backend', 'architecture', 'pooling', 'projection', 'dimensions', 'passagePrefix',
  'queryPrefix', 'tokenizerPolicy', 'qualificationReceiptSha256'
];

/**
 * An explicit qualification receipt is necessary; a localhost URL or dtype label
 * alone does not establish local execution or equivalence to the ONNX space.
 * The host owns artifact hashing, runtime lineage and reference-quality checks.
 */
export function resolveGgufQualification(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || Object.keys(manifest).some(key => !fields.includes(key))
    || fields.some(key => !Object.hasOwn(manifest, key))) throw fail('Complete GGUF qualification required.');
  let endpoint;
  try { endpoint = new URL(manifest.endpoint); } catch { throw fail('Invalid loopback endpoint.'); }
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || !['/', ''].includes(endpoint.pathname)) throw fail('An explicit numeric loopback origin is required.');
  if (manifest.schema !== 'history-eg2-gguf.v1' || manifest.deviceIdentifier !== null
    || !['alias', 'instanceId', 'engineBuild', 'backend', 'precision'].every(key => label(manifest[key]))
    || !['ggufSha256', 'tokenizerSha256', 'supportEvidenceSha256', 'qualificationReceiptSha256']
      .every(key => hash(manifest[key]))
    || !commit(manifest.engineCommit)
    || !['bf16-fp32-accumulation', 'q8_0-qualified'].includes(manifest.precision)
    || manifest.architecture !== 'gemma-embedding2'
    || manifest.pooling !== 'native-eg2-mask-aware-pooling'
    || manifest.projection !== 'native-eg2-learned-768'
    || manifest.dimensions !== 768
    || manifest.passagePrefix !== 'title: none | text: '
    || !['task: search result | query: ', 'task: code retrieval | query: ',
      'task: question answering | query: '].includes(manifest.queryPrefix)
    || manifest.tokenizerPolicy !== 'exact-prefixed-input-with-special-tokens-no-truncation') {
    throw fail('Unsupported or incomplete EG2 runtime qualification.');
  }
  const copy = Object.freeze({ ...manifest, endpoint: endpoint.origin });
  const documentIdentity = Object.freeze(Object.fromEntries(fields.filter(key => ![
    'endpoint', 'alias', 'instanceId', 'deviceIdentifier', 'queryPrefix', 'qualificationReceiptSha256'
  ].includes(key)).map(key => [key, copy[key]])));
  const documentIdentityKey = digest(JSON.stringify(documentIdentity));
  return Object.freeze({ ...copy, documentIdentity, documentIdentityKey, identityKey: documentIdentityKey,
    queryIdentityKey: digest(JSON.stringify({ schema: 'history-eg2-gguf-query.v1',
      documentIdentityKey, queryPrefix: copy.queryPrefix })),
    representationIdentityKey: digest(JSON.stringify({ schema: 'history-eg2-gguf-representation.v1',
      documentIdentityKey, dimensions: 768, encoding: 'float32', normalization: 'l2' })), batchSize: 1 });
}

const defaults = Object.freeze({
  maxQueuedInputs: 64, maxQueuedChars: 65536, maxQueuedTokens: 32768,
  maxInputTokens: 2048, maxBodyBytes: 65536, maxResponseBytes: 65536, timeoutMs: 60000
});

function resolveBounds(options) {
  if (Object.keys(options).some(key => !Object.hasOwn(defaults, key))) throw fail('Unknown GGUF admission bound.');
  const result = { ...defaults, ...options };
  for (const [key, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > defaults[key]) {
      throw fail('GGUF bounds may only narrow the qualified single-flight defaults.');
    }
  }
  return Object.freeze(result);
}

async function readBoundedJson(response, limit) {
  if (!response.ok || !response.body) throw fail('GGUF endpoint rejected the request.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw fail('GGUF response exceeds the admission bound.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
  catch { throw fail('Malformed GGUF response.'); }
}

function checkedVector(result, alias) {
  if (result.model !== alias || !Array.isArray(result.data) || result.data.length !== 1
    || result.data[0]?.index !== 0 || !Array.isArray(result.data[0]?.embedding)
    || result.data[0].embedding.length !== 768) throw fail('Unexpected GGUF model, index, cardinality or projection.');
  const values = result.data[0].embedding;
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) {
    throw fail('Nonfinite GGUF embedding.');
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || Math.abs(norm - 1) > 0.001) throw fail('GGUF output is not normalized.');
  const output = Float32Array.from(values);
  if (!output.every(Number.isFinite)) throw fail('GGUF values overflow float32.');
  return output;
}

/**
 * Preparatory adapter: never loads/downloads a model, selects a device or retries.
 * verifyLoadedInstance must inspect a specific local loaded instance and return
 * all pinned manifest fields. countTokens is a synchronous qualified local
 * tokenizer including special tokens; SDK array embed() is deliberately unused.
 */
export function createQualifiedGgufEmbeddingRuntime(manifest, {
  verifyLoadedInstance, countTokens, fetchImpl = globalThis.fetch, bounds = {}
} = {}) {
  const config = resolveGgufQualification(manifest);
  const limits = resolveBounds(bounds);
  if (typeof verifyLoadedInstance !== 'function' || typeof countTokens !== 'function'
    || typeof fetchImpl !== 'function') throw fail('Explicit local instance verifier and tokenizer required.');
  let poisoned = false, active = false, queuedInputs = 0, queuedChars = 0, queuedTokens = 0;
  let tail = Promise.resolve();
  const verify = async (signal) => {
    const actual = await verifyLoadedInstance({ signal });
    if (!actual || fields.some(key => actual[key] !== config[key])) throw fail('Loaded local instance changed or is unqualified.');
  };

  const request = async (item, signal) => {
    if (poisoned) throw fail('GGUF admission stopped; diagnose uncertain execution before creating a new runtime.');
    signal?.throwIfAborted();
    active = true;
    const controller = new AbortController();
    let dispatched = false;
    let timer;
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const timed = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(fail('GGUF deadline expired; native execution may still be active.'));
        }, limits.timeoutMs);
      });
      const work = (async () => {
        await verify(controller.signal);
        controller.signal.throwIfAborted();
        dispatched = true;
        const response = await fetchImpl(config.endpoint + '/v1/embeddings', {
          method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
          body: item.body, redirect: 'error', signal: controller.signal
        });
        const result = checkedVector(await readBoundedJson(response, limits.maxResponseBytes), config.alias);
        await verify(controller.signal);
        controller.signal.throwIfAborted();
        return result;
      })();
      return await Promise.race([work, timed]);
    } catch (error) {
      // Cancellation/timeout after dispatch does not establish native termination.
      // Even preflight timeout is uncertain: reject future admissions until diagnosed.
      if (dispatched || controller.signal.aborted) poisoned = true;
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      active = false;
    }
  };

  const submit = (texts, prefix, signal) => {
    if (poisoned) return Promise.reject(fail('GGUF admission is stopped.'));
    signal?.throwIfAborted();
    if (!Array.isArray(texts) || texts.length < 1 || texts.length > limits.maxQueuedInputs) {
      throw fail('Invalid GGUF input count.');
    }
    const items = texts.map(text => {
      if (typeof text !== 'string') throw fail('GGUF input must be an exact string.');
      const input = prefix + text;
      if (input.length > limits.maxQueuedChars) throw fail('GGUF input exceeds text bound.');
      const tokens = countTokens(input);
      if (!Number.isSafeInteger(tokens) || tokens < 1 || tokens > limits.maxInputTokens) {
        throw fail('GGUF token admission failed; source must be re-spanned, never truncated.');
      }
      const body = JSON.stringify({ model: config.alias, input, encoding_format: 'float' });
      if (Buffer.byteLength(body) > limits.maxBodyBytes) throw fail('GGUF request exceeds body bound.');
      return { body, chars: input.length, tokens };
    });
    const chars = items.reduce((sum, item) => sum + item.chars, 0);
    const tokens = items.reduce((sum, item) => sum + item.tokens, 0);
    if (queuedInputs + items.length > limits.maxQueuedInputs
      || queuedChars + chars > limits.maxQueuedChars || queuedTokens + tokens > limits.maxQueuedTokens) {
      throw fail('GGUF queue capacity exceeded.');
    }
    queuedInputs += items.length; queuedChars += chars; queuedTokens += tokens;
    const result = tail.then(async () => {
      const outputs = [];
      for (const item of items) outputs.push(await request(item, signal));
      return outputs;
    }).finally(() => {
      queuedInputs -= items.length; queuedChars -= chars; queuedTokens -= tokens;
    });
    tail = result.catch(() => {});
    return result;
  };
  return Object.freeze({
    config,
    encodeBatch: (texts, { signal } = {}) => submit(texts, config.passagePrefix, signal),
    async encodeQuery(text, { signal } = {}) { return (await submit([text], config.queryPrefix, signal))[0]; },
    admissionStatus: () => Object.freeze({ poisoned, active, queuedInputs, queuedChars, queuedTokens, limits })
  });
}
