const MODES = new Set(['code', 'prose', 'extracted-prose', 'records']);
const admitted = new WeakSet();
const invalid = message => Object.assign(new Error(message), { code: 'ERR_EVAL_JUDGMENT' });

export const assertEvaluationMode = mode => {
  if (!MODES.has(mode)) throw invalid('Relevance judgment mode must be code, prose, extracted-prose or records.');
};

/** Dataset predicates must identify at least one supported matching field.
 * Empty rows and falsey/unsupported explicit fields cannot become wildcards.
 * Freeze only admitted scalar data; accessors do not supply label evidence. */
export const captureEvaluationJudgment = original => {
  if (!original || typeof original !== 'object' || Array.isArray(original)) throw invalid('Each relevance judgment must be an object with an explicit file, name or kind predicate.');
  if (admitted.has(original)) return original;
  const value = {};
  for (const key of ['file', 'name', 'kind', 'mode']) {
    const descriptor = Object.getOwnPropertyDescriptor(original, key);
    if (!descriptor) {
      if (key in original) throw invalid(`Inherited relevance judgment ${key} is not explicit label evidence.`);
      continue;
    }
    if (!Object.hasOwn(descriptor, 'value')) throw invalid(`Relevance judgment ${key} must be scalar data, not an accessor.`);
    const field = descriptor.value;
    if (typeof field !== 'string' || !field.trim()) throw invalid(`Explicit relevance judgment ${key} must be a nonempty string.`);
    if (key === 'mode') assertEvaluationMode(field);
    value[key] = field;
  }
  if (!Object.hasOwn(value, 'file') && !Object.hasOwn(value, 'name') && !Object.hasOwn(value, 'kind')) {
    throw invalid('A relevance judgment requires an explicit file, name or kind predicate; an empty row cannot match every hit.');
  }
  Object.freeze(value); admitted.add(value); return value;
};

export const captureEvaluationJudgments = rows => {
  if (!Array.isArray(rows)) throw invalid('Relevance judgments require an explicit array.');
  const captured = [];
  for (let index = 0; index < rows.length; index++) {
    if (!Object.hasOwn(rows, index)) throw invalid(`Missing relevance judgment at slot ${index + 1}.`);
    captured.push(captureEvaluationJudgment(rows[index]));
  }
  return captured;
};
