const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const range = { type: 'object', additionalProperties: false, required: ['start', 'end'], properties: { start: count, end: count } };
const identity = { type: 'string', pattern: '^heading1:[a-f0-9]{64}$' };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const nullableDigest = { ...digest, type: ['string', 'null'] };
const coverage = { type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'producer', 'producerVersion', 'scope', 'coordinateSystem', 'state', 'source', 'scannedLength', 'limits', 'observed', 'omittedHeadings', 'reasonCounts', 'samples'],
  properties: { schemaVersion: { const: 1 }, producer: { enum: ['source-outline:rst', 'source-outline:asciidoc'] }, producerVersion: { const: '1' },
    scope: { const: 'top-level-heading-syntax-subset' }, coordinateSystem: { const: 'utf16-provided-source' }, state: { enum: ['complete', 'partial'] },
    source: { type: 'object', additionalProperties: false, required: ['encoding', 'length', 'admittedLength', 'textHash', 'admittedTextHash'],
      properties: { encoding: { const: 'utf16-js-string' }, length: count, admittedLength: count, textHash: nullableDigest, admittedTextHash: digest } },
    scannedLength: count, omittedHeadings: { const: null },
    limits: { type: 'object', additionalProperties: false, required: ['maxChars', 'maxLines', 'maxLineChars', 'maxHeadings', 'maxDepth', 'maxWork'],
      properties: Object.fromEntries(['maxChars', 'maxLines', 'maxLineChars', 'maxHeadings', 'maxDepth', 'maxWork'].map(key => [key, count])) },
    observed: { type: 'object', additionalProperties: false, required: ['work', 'headings'], properties: { work: count, headings: count } },
    reasonCounts: { type: 'object', maxProperties: 16, additionalProperties: count },
    samples: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['reason', 'line'],
      properties: { reason: { type: 'string', maxLength: 128 }, line: { ...count, type: ['integer', 'null'] } } } }
  } };
const heading = { type: 'object', additionalProperties: false,
  required: ['id', 'title', 'titleRange', 'sourceRange', 'level', 'levelBasis', 'style', 'parentId', 'parentState', 'anchor'],
  properties: { id: identity, title: { type: 'string', minLength: 1, maxLength: 4096 }, titleRange: range, sourceRange: range,
    level: count, levelBasis: { enum: ['observed-admitted-adornment-style-order', 'authored-equals-count'] },
    style: { oneOf: [{ type: 'object', additionalProperties: false, required: ['character', 'overline', 'length'],
      properties: { character: { type: 'string', minLength: 1, maxLength: 1 }, overline: { type: 'boolean' }, length: count } },
    { type: 'object', additionalProperties: false, required: ['marker'], properties: { marker: { type: 'string', pattern: '^={1,6}$' } } }] },
    parentId: { ...identity, type: ['string', 'null'] }, parentState: { enum: ['known-within-admitted-subset', 'unqualified-prior-candidate'] },
    anchor: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'range'],
      properties: { value: { type: 'string', maxLength: 4096 }, range } }
  } };
export const SOURCE_OUTLINE_SCHEMA = { type: 'object', additionalProperties: false, required: ['coverage', 'heading', 'sourceOnly', 'preamble'],
  properties: { coverage, heading: { anyOf: [heading, { type: 'null' }] }, sourceOnly: { type: 'boolean' }, preamble: { type: 'boolean' } } };
