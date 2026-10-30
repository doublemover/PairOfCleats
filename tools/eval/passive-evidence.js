/** Matching/rank evidence is own passive data. Introspection failures propagate
 * exactly; neither inherited fields nor accessors are invoked as evidence. */
export const readEvaluationData = (original, key, invalid) => {
  const descriptor = Object.getOwnPropertyDescriptor(original, key);
  if (!descriptor) {
    if (key in original) throw invalid(`Inherited evaluation ${String(key)} is not original passive evidence.`);
    return { present: false };
  }
  if (!Object.hasOwn(descriptor, 'value')) throw invalid(`Evaluation ${String(key)} cannot be an accessor.`);
  return { present: true, value: descriptor.value };
};

export const captureEvaluationArray = (original, invalid) => {
  if (!Array.isArray(original)) throw invalid('Evaluation evidence requires an explicit array.');
  const length = readEvaluationData(original, 'length', invalid).value;
  if (!Number.isSafeInteger(length) || length < 0) throw invalid('Evaluation array requires an original passive length.');
  const values = [];
  for (let index = 0; index < length; index++) {
    const field = readEvaluationData(original, index, invalid);
    if (!field.present) throw invalid(`Evaluation evidence requires a dense original slot at ${index + 1}.`);
    values.push(field.value);
  }
  return Object.freeze(values);
};
