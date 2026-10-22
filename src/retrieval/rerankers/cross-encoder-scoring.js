import { createHash } from 'node:crypto';
import { throwIfAborted } from '../../shared/abort.js';
import { buildRetrievalHitKey } from '../hit-comparison.js';
import { createCrossEncoderTensorScope, crossEncoderCleanupFailure } from './local-resource-owner.js';
import { captureCrossEncoderOutputs } from './cross-encoder-outputs.js';

const invalid = message => Object.assign(new Error(message), { code: 'ERR_LOCAL_RERANKER_PROFILE' });

export const decodeCrossEncoderLogit = tensor => {
  const type = tensor?.type, dims = tensor?.dims, data = tensor?.data;
  if (type !== 'float32' || !Array.isArray(dims) || dims.length !== 2
    || !Object.hasOwn(dims, 0) || !Object.hasOwn(dims, 1) || dims[0] !== 1 || dims[1] !== 1
    || !(data instanceof Float32Array) || data.length !== 1) throw invalid('Cross-encoder must return exactly one finite FP32 logit.');
  const logit = data[0];
  if (!Number.isFinite(logit)) throw invalid('Cross-encoder must return exactly one finite FP32 logit.');
  return logit >= 0 ? 1 / (1 + Math.exp(-logit)) : Math.exp(logit) / (1 + Math.exp(logit));
};

/** Shared by the actual local adapter and inert source-admission fixtures. The
 * caller owns serialized session admission and must retain pending tensors on
 * failed disposal. No runtime/model/source acquisition happens in this owner.
 */
export const scoreLocalCrossEncoderPairs = async ({ profile, query, members, sourceContext,
  loadSource, tokenizer, session, Tensor, pendingTensors, pendingTensorOwners, signal }) => {
  throwIfAborted(signal);
  const queryTokens = tokenizer.encode(query, { add_special_tokens: false });
  if (!Array.isArray(queryTokens) || queryTokens.length > profile.maxQueryTokens) throw invalid('Cross-encoder query token allowance exceeded; truncation is disabled.');
  const scores = [], seen = new Set();
  let characters = 0, tokens = 0;
  for (const [index, hit] of members.entries()) {
    throwIfAborted(signal);
    const key = buildRetrievalHitKey(hit, null, sourceContext), start = hit.start, end = hit.end;
    if (!key || seen.has(key)) throw invalid('Cross-encoder source members require unique stable identities.');
    seen.add(key);
    const source = await loadSource({ hit, key, generation: sourceContext.generation, mode: sourceContext.mode,
      maxChars: profile.maxPassageChars, signal });
    throwIfAborted(signal);
    if (source?.key !== key || source.generation !== sourceContext.generation || source.complete !== true
      || source.offsetUnit !== 'utf16-code-unit' || source.start !== start || source.end !== end
      || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start
      || typeof source.text !== 'string' || source.text.length !== end - start
      || !source.text || source.text.length > profile.maxPassageChars
      || !/^[a-f0-9]{64}$/u.test(source.contentDigest || '')
      || createHash('sha256').update(source.text).digest('hex') !== source.contentDigest) throw invalid('Rerank source loader returned stale, partial or unqualified source text.');
    characters += query.length + source.text.length;
    if (characters > profile.maxTotalChars) throw invalid('Cross-encoder total character allowance exceeded.');
    const encoded = tokenizer(query, { text_pair: source.text, padding: false,
      truncation: false, return_tensor: false, return_token_type_ids: true });
    const width = encoded.input_ids?.length;
    tokens += width || 0;
    if (!Number.isSafeInteger(width) || width < 1 || width > profile.maxPairTokens || tokens > profile.maxTotalTokens) throw invalid('Cross-encoder pair/total token allowance exceeded; truncation is disabled.');
    const feeds = {};
    const tensors = createCrossEncoderTensorScope({ pendingTensors, pendingTensorOwners });
    let outputs, primaryError, hasPrimary = false;
    try {
      for (const name of session.inputNames) {
        const row = encoded[name];
        if (!Array.isArray(row) || row.length !== width || row.some(value => !Number.isSafeInteger(value) || value < 0
          || name !== 'input_ids' && value > 1)) throw invalid('Cross-encoder input tensor is malformed.');
        feeds[name] = tensors.add(new Tensor('int64', BigInt64Array.from(row, BigInt), [1, width]));
      }
      outputs = await session.run(feeds, ['logits']);
      const logits = captureCrossEncoderOutputs(outputs, tensors);
      throwIfAborted(signal);
      scores.push({ index, score: decodeCrossEncoderLogit(logits) });
    } catch (error) { primaryError = error; hasPrimary = true; tensors.retainFailure(error); throw error;
    } finally {
      try { await tensors.close(); }
      catch (cleanupError) {
        if (!hasPrimary && signal?.aborted) {
          try { throwIfAborted(signal); } catch (error) { primaryError = error; hasPrimary = true; }
        }
        if (hasPrimary) throw crossEncoderCleanupFailure({ owner: tensors, hasPrimary, primaryError,
          cleanupErrors: [cleanupError] });
        throw cleanupError;
      }
      if(!hasPrimary)throwIfAborted(signal);
    }
  }
  return scores;
};
