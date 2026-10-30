/** Format admission does not copy decoded rows or replace family row schemas. */
export const invalidArtifactPayload = (detail, context = {}) => {
  const { artifact = null, sourcePath = null } = context || {};
  const label = [artifact, sourcePath].filter(Boolean).join(' at ');
  const error = new Error(`Invalid artifact payload${label ? ` for ${label}` : ''}: ${detail}`);
  error.code = 'ERR_ARTIFACT_INVALID';
  if (artifact) error.artifact = artifact;
  if (sourcePath) error.sourcePath = sourcePath;
  return error;
};

export const admitJsonArrayPayload = (payload, context) => {
  if (!Array.isArray(payload)) throw invalidArtifactPayload('expected a JSON array', context);
  return payload;
};
