export const ARCHITECTURE_CHECK_OPTIONS = {
  repo: { type: 'string' },
  rules: { type: 'string' },
  format: { type: 'string' },
  json: { type: 'boolean', default: false },
  failOnViolation: { type: 'boolean', default: false },
  maxViolations: { type: 'number' },
  maxEdgesExamined: { type: 'number' }
};

export const SUGGEST_TESTS_OPTIONS = {
  repo: { type: 'string' },
  changed: { type: 'array' },
  changedFile: { type: 'string' },
  max: { type: 'number' },
  format: { type: 'string' },
  json: { type: 'boolean', default: false },
  testPattern: { type: 'array' },
  maxDepth: { type: 'number' },
  maxNodes: { type: 'number' },
  maxEdges: { type: 'number' },
  maxPaths: { type: 'number' },
  maxCandidates: { type: 'number' },
  maxWorkUnits: { type: 'number' },
  maxWallClockMs: { type: 'number' }
};

