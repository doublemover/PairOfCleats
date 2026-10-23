import { readEvaluationData } from './passive-evidence.js';

const admitted = new WeakSet();
const invalid = message => Object.assign(new Error(message), { code: 'ERR_EVAL_HIT_IDENTITY' });
const textFields = ['file', 'chunkUid', 'repoId', 'repoRoot'];
const modes = new Set(['code', 'prose', 'extracted-prose', 'records']);

/** Capture only the existing matcher and stable hit-identity evidence before
 * invoking any matching callback. Metadata never becomes relevance evidence. */
export const captureEvaluationHit = original => {
  if (!original || typeof original !== 'object' || Array.isArray(original)) throw invalid('Judged retrieval hits must be object rows.');
  if (admitted.has(original)) return original;
  const value = {};
  for (const key of [...textFields, 'name', 'kind', 'mode', 'start', 'end', 'startLine', 'endLine']) {
    const field = readEvaluationData(original, key, invalid);
    if (!field.present) continue;
    const data = field.value;
    if (textFields.includes(key) && data != null && (typeof data !== 'string' || !data.trim())) throw invalid(`Judged retrieval requires scalar nonempty ${key} identity.`);
    if (key === 'mode' && data != null && !modes.has(data)) throw invalid('Judged retrieval mode must identify a canonical cohort.');
    if (['start', 'end', 'startLine', 'endLine'].includes(key) && data != null
      && (!Number.isSafeInteger(data) || data < (key.endsWith('Line') ? 1 : 0))) throw invalid('Judged retrieval ranges require passive integer coordinates.');
    // Numeric/object names and kinds never become matching or distinct-document
    // evidence through coercion. Existing string matcher behavior is retained.
    value[key] = (key === 'name' || key === 'kind') && typeof data !== 'string' ? undefined : data;
  }
  for (const [start, end] of [['start', 'end'], ['startLine', 'endLine']]) {
    if (value[start] != null && value[end] != null && value[end] < value[start]) throw invalid('Judged retrieval range ends before its original start.');
  }
  const metadata = readEvaluationData(original, 'metaV2', invalid);
  if (metadata.present && metadata.value != null) {
    if (typeof metadata.value !== 'object' || Array.isArray(metadata.value)) throw invalid('Judged retrieval metadata identity must be an object.');
    const chunk = readEvaluationData(metadata.value, 'chunkUid', invalid);
    if (chunk.present) {
      if (chunk.value != null && (typeof chunk.value !== 'string' || !chunk.value.trim())) throw invalid('Judged retrieval metadata requires scalar nonempty chunk identity.');
      value.metaV2 = Object.freeze({ chunkUid: chunk.value });
    }
  }
  Object.freeze(value); admitted.add(value); return value;
};
