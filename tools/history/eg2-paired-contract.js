export function validateTrialIdentity(identity) {
  if(identity?.provider!=='cpu')throw new Error('Qualification trial provider must be CPU.');
  for(const key of ['modelRevision','modelSha256','tokenizerSha256','graphSha256','runtimeVersion','dtype','documentPrefix','queryPrefix','chunkerIdentity'])
    if(typeof identity[key]!=='string'||!identity[key])throw new Error('Complete numerical/input identity required: '+key);
  if(!/^[a-f0-9]{40}$/.test(identity.modelRevision))throw new Error('Pinned model revision required.');
  for(const key of ['modelSha256','tokenizerSha256','graphSha256'])if(!/^[a-f0-9]{64}$/.test(identity[key]))throw new Error('Artifact SHA256 required: '+key);
  if(!Number.isInteger(identity.dimensions)||identity.dimensions<1||identity.dimensions>8192)throw new Error('Dimensions required.');
  if(!Number.isInteger(identity.maxLength)||identity.maxLength<1||identity.maxLength>8192)throw new Error('Explicit truncation ceiling required.');
  return identity;
}

export const validateTrialInputContract = (reference, candidate) => {
  validateTrialIdentity(reference);
  validateTrialIdentity(candidate);
  for (const key of ['modelRevision', 'tokenizerSha256', 'documentPrefix', 'queryPrefix',
    'maxLength', 'dimensions', 'chunkerIdentity']) {
    if (reference[key] !== candidate[key]) throw new Error(`Reference/candidate input contract differs: ${key}`);
  }
};

/** Numerical implementation hashes/dtypes may differ. The effective source and
 * tokenizer/prompt/truncation/chunker contract and each declared shape may not. */
export const validatePairedTrialOutputs = input => {
  validateTrialInputContract(input?.reference?.identity, input?.candidate?.identity);
  for (const name of ['documents', 'queries']) {
    const prefix = input.reference.identity[name === 'documents' ? 'documentPrefix' : 'queryPrefix'];
    const rows = [];
    for (const side of ['reference', 'candidate']) {
      const items = input[side][name];
      if (!Array.isArray(items) || !items.length || items.length > 10000) throw new Error(`Bounded ${side} ${name} required.`);
      const map = new Map();
      for (const row of items) {
        if (typeof row?.id !== 'string' || !row.id || map.has(row.id)
          || typeof row.effectiveInput !== 'string' || !row.effectiveInput.startsWith(prefix)
          || row.effectiveInput.length <= prefix.length || row.effectiveInput.length > 100000
          || !Array.isArray(row.vector) || row.vector.length !== input[side].identity.dimensions) {
          throw new Error(`Exact paired input and declared vector dimensions required: ${side} ${name}`);
        }
        map.set(row.id, row);
      }
      rows.push(map);
    }
    if (rows[0].size !== rows[1].size) throw new Error(`Paired ${name} coverage differs.`);
    for (const [id, reference] of rows[0]) {
      if (reference.effectiveInput !== rows[1].get(id)?.effectiveInput) throw new Error(`Paired effective input differs: ${id}`);
    }
  }
  return input;
};
