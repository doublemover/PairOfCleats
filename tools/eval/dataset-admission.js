import { captureEvaluationJudgments } from './judgments.js';

const invalid = message => Object.assign(new Error(message), { code: 'ERR_EVAL_DATASET' });
const ownData = (entry, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(entry, key);
  if (!descriptor) {
    if (key in entry) throw invalid(`Evaluation ${key} must be own dataset evidence.`);
    return { present: false };
  }
  if (!Object.hasOwn(descriptor, 'value')) throw invalid(`Evaluation ${key} cannot be an accessor.`);
  return { present: true, value: descriptor.value };
};
const labels = (entry, key) => {
  const field = ownData(entry, key);
  if (!field.present) return field;
  if (!Array.isArray(field.value)) throw invalid(`Explicit evaluation ${key} must be a judgment array.`);
  const rows = [], length = Object.getOwnPropertyDescriptor(field.value, 'length').value;
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(field.value, index);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid(`Evaluation ${key} requires dense passive judgment rows.`);
    rows.push(descriptor.value);
  }
  return { present: true, value: Object.freeze(captureEvaluationJudgments(rows)) };
};

/** Admit the selected dataset before any search. Explicit invalid aliases or
 * gold labels cannot disappear through truthiness/Array.isArray fallbacks. */
export const captureEvaluationDatasetCases = cases => {
  if (!Array.isArray(cases)) throw invalid('Evaluation dataset requires an explicit array of cases.');
  const accepted = [], length = Object.getOwnPropertyDescriptor(cases, 'length').value;
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(cases, index);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid('Evaluation dataset requires dense passive case rows.');
    const entry = descriptor.value;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw invalid('Each evaluation case must be an object.');
    const query = ownData(entry, 'query'), mode = ownData(entry, 'mode');
    if (!query.present || typeof query.value !== 'string' || !query.value.trim()) throw invalid('Each evaluation case requires a nonempty query string.');
    const relevant = labels(entry, 'relevant'), expect = labels(entry, 'expect'), gold = labels(entry, 'gold');
    accepted.push(Object.freeze({ entry, query: query.value.trim(), mode: mode.value ?? null,
      silver: relevant.present ? relevant.value : expect.present ? expect.value : Object.freeze([]),
      gold: gold.present ? gold.value : Object.freeze([]) }));
  }
  return Object.freeze(accepted);
};
