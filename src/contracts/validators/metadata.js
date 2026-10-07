/** Validate relationships that JSON Schema field types cannot express. */
export const validateMetadataV2Semantics = (metadata) => {
  const errors = [];
  if (!metadata || typeof metadata !== 'object') return errors;
  const ordered = (value, start, end, label) => {
    if (Number.isFinite(value?.[start]) && Number.isFinite(value?.[end])
      && value[start] > value[end]) {
      errors.push(`${label}/${end} must not precede ${start}`);
    }
  };
  for (const key of ['range', 'segment']) {
    ordered(metadata[key], 'start', 'end', `/${key}`);
    ordered(metadata[key], 'startLine', 'endLine', `/${key}`);
  }
  ordered(metadata.segment, 'pageStart', 'pageEnd', '/segment');
  ordered(metadata.segment, 'paragraphStart', 'paragraphEnd', '/segment');
  for (const [start, end] of [['start', 'end'], ['startLine', 'endLine']]) {
    const range = metadata.range;
    const segment = metadata.segment;
    if (Number.isFinite(range?.[start]) && Number.isFinite(segment?.[start])
      && range[start] < segment[start]) {
      errors.push(`/range/${start} must be within segment`);
    }
    if (Number.isFinite(range?.[end]) && Number.isFinite(segment?.[end])
      && range[end] > segment[end]) {
      errors.push(`/range/${end} must be within segment`);
    }
  }
  return errors;
};
