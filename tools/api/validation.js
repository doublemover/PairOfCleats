import Ajv from 'ajv';

const stringListSchema = {
  anyOf: [
    { type: 'string' },
    { type: 'array', items: { type: 'string' } }
  ]
};

const metaSchema = {
  anyOf: [
    { type: 'string' },
    {
      type: 'array',
      items: {
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'object' },
          { type: 'null' }
        ]
      }
    },
    { type: 'object', additionalProperties: true }
  ]
};

const searchRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1 },
    repoPath: { type: 'string' },
    repo: { type: 'string' },
    output: { type: 'string', enum: ['compact', 'json', 'full'] },
    mode: { type: 'string', enum: ['code', 'prose', 'records', 'both', 'all', 'extracted-prose'] },
    backend: { type: 'string', enum: ['auto', 'memory', 'sqlite', 'sqlite-fts', 'lmdb'] },
    ann: { type: 'boolean' },
    top: { type: 'integer', minimum: 0 },
    context: { type: 'integer', minimum: 0 },
    type: { type: 'string' },
    author: { type: 'string' },
    import: { type: 'string' },
    calls: { type: 'string' },
    uses: { type: 'string' },
    signature: { type: 'string' },
    param: { type: 'string' },
    decorator: { type: 'string' },
    inferredType: { type: 'string' },
    returnType: { type: 'string' },
    throws: { type: 'string' },
    reads: { type: 'string' },
    writes: { type: 'string' },
    mutates: { type: 'string' },
    alias: { type: 'string' },
    awaits: { type: 'string' },
    risk: { type: 'string' },
    riskTag: { type: 'string' },
    riskSource: { type: 'string' },
    riskSink: { type: 'string' },
    riskCategory: { type: 'string' },
    riskFlow: { type: 'string' },
    branchesMin: { type: 'integer', minimum: 0 },
    loopsMin: { type: 'integer', minimum: 0 },
    breaksMin: { type: 'integer', minimum: 0 },
    continuesMin: { type: 'integer', minimum: 0 },
    churnMin: { type: 'integer', minimum: 0 },
    chunkAuthor: { type: 'string' },
    modifiedAfter: { type: 'string' },
    modifiedSince: { type: 'integer', minimum: 0 },
    visibility: { type: 'string' },
    extends: { type: 'string' },
    lint: { type: 'boolean' },
    async: { type: 'boolean' },
    generator: { type: 'boolean' },
    returns: { type: 'boolean' },
    branch: { type: 'string' },
    lang: { type: 'string' },
    case: { type: 'boolean' },
    caseFile: { type: 'boolean' },
    caseTokens: { type: 'boolean' },
    path: stringListSchema,
    paths: stringListSchema,
    file: stringListSchema,
    ext: stringListSchema,
    filter: { type: 'string' },
    meta: metaSchema,
    metaJson: {
      type: ['string', 'object', 'array', 'number', 'boolean', 'null']
    }
  }
};

const formatValidationErrors = (errors = []) => errors.map((err) => {
  const path = err.instancePath || '#';
  if (err.keyword === 'additionalProperties') {
    return `${path} has unknown field "${err.params?.additionalProperty}"`;
  }
  if (err.keyword === 'required') {
    return `${path} missing required field "${err.params?.missingProperty}"`;
  }
  return `${path} ${err.message}`.trim();
});

export const createSearchValidator = () => {
  const ajv = new Ajv({ allErrors: false, strict: false });
  const validateSearchRequest = ajv.compile(searchRequestSchema);
  return (payload) => {
    const valid = validateSearchRequest(payload);
    if (valid) return { ok: true };
    return { ok: false, errors: formatValidationErrors(validateSearchRequest.errors || []) };
  };
};
