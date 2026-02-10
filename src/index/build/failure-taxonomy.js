import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';

export const FAILURE_CATEGORIES = Object.freeze([
  'parse',
  'tooling',
  'worker-pool',
  'artifact-io',
  'sqlite',
  'unknown'
]);

const FAILURE_SCHEMA = {
  type: 'object',
  required: ['category', 'message'],
  additionalProperties: true,
  properties: {
    category: { type: 'string', enum: FAILURE_CATEGORIES },
    message: { type: 'string' },
    phase: { type: 'string' },
    stage: { type: 'string' },
    file: { type: 'string' },
    languageId: { type: 'string' },
    shardId: { type: 'string' },
    workerId: { type: ['string', 'number'] },
    tool: { type: 'string' },
    retryable: { type: 'boolean' },
    hints: { type: 'array', items: { type: 'string' } },
    mitigations: { type: 'array', items: { type: 'string' } }
  }
};

const FAILURE_MITIGATIONS = {
  parse: [
    'reduce file caps (indexing.fileCaps)',
    'disable tree-sitter for the language',
    'skip heavy relations in stage1'
  ],
  tooling: [
    'disable tooling integration',
    'verify tool install/versions',
    'run with --stage1 to isolate tooling'
  ],
  'worker-pool': [
    'disable worker pool or lower maxWorkers',
    'reduce workerPool.maxFileBytes threshold',
    'retry with PAIROFCLEATS_WORKER_POOL=off'
  ],
  'artifact-io': [
    'clear cache/build artifacts and rebuild',
    'disable artifact compression temporarily',
    'check filesystem free space'
  ],
  sqlite: [
    'rebuild sqlite indexes from bundles',
    'disable sqlite-fts backend temporarily',
    'run with --build-index only'
  ],
  unknown: []
};

const ajv = createAjv({ allErrors: true, strict: false });
const validate = compileSchema(ajv, FAILURE_SCHEMA, { clone: false });

const normalizeString = (value) => (typeof value === 'string' ? value : '');

const resolveCategory = (event) => {
  const explicit = normalizeString(event?.category).toLowerCase();
  if (FAILURE_CATEGORIES.includes(explicit)) return explicit;
  const phase = normalizeString(event?.phase).toLowerCase();
  const tool = normalizeString(event?.tool).toLowerCase();
  if (phase.includes('worker') || tool.includes('worker')) return 'worker-pool';
  if (phase.includes('sqlite') || tool.includes('sqlite')) return 'sqlite';
  if (phase.includes('artifact') || phase.includes('bundle') || phase.includes('postings')) return 'artifact-io';
  if (phase.includes('import') || phase.includes('tool')) return 'tooling';
  if (phase.includes('parse') || phase.includes('tree-sitter')) return 'parse';
  return 'unknown';
};

const buildHints = (event) => {
  const hints = [];
  if (event?.file) hints.push(`file=${event.file}`);
  if (event?.languageId) hints.push(`lang=${event.languageId}`);
  if (event?.phase) hints.push(`phase=${event.phase}`);
  if (event?.stage) hints.push(`stage=${event.stage}`);
  if (event?.shardId) hints.push(`shard=${event.shardId}`);
  if (event?.workerId !== undefined && event?.workerId !== null) {
    hints.push(`worker=${event.workerId}`);
  }
  return hints;
};

export function normalizeFailureEvent(event = {}) {
  const message = normalizeString(event.message) || normalizeString(event.error) || 'unknown failure';
  const workerId = event.workerId != null ? event.workerId : (event.threadId != null ? event.threadId : null);
  const category = resolveCategory(event);
  const hints = Array.isArray(event.hints) && event.hints.length
    ? event.hints
    : buildHints(event);
  const mitigations = Array.isArray(event.mitigations) && event.mitigations.length
    ? event.mitigations
    : (FAILURE_MITIGATIONS[category] || []);
  return {
    ...event,
    message,
    ...(workerId != null ? { workerId } : {}),
    category,
    hints,
    mitigations
  };
}

export function validateFailureEvent(event) {
  const ok = validate(event);
  if (ok) return { ok: true, errors: [] };
  const errors = (validate.errors || []).map((err) => {
    const path = err.instancePath || '#';
    return `${path} ${err.message || 'invalid'}`.trim();
  });
  return { ok: false, errors };
}
