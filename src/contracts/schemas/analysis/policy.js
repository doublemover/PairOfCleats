import {
  nullableNumber,
  nullableString,
  semverString
} from './primitives.js';

const riskRuleSchema = {
  type: 'object',
  required: ['id', 'name', 'patterns'],
  properties: {
    id: { type: 'string' },
    type: { type: 'string' },
    name: { type: 'string' },
    category: nullableString,
    severity: nullableString,
    tags: { type: 'array', items: { type: 'string' } },
    confidence: nullableNumber,
    languages: { type: ['array', 'null'], items: { type: 'string' } },
    patterns: { type: 'array', items: { type: 'string' } },
    requires: nullableString
  },
  additionalProperties: true
};

export const RISK_RULES_BUNDLE_SCHEMA = {
  type: 'object',
  required: ['version', 'sources', 'sinks', 'sanitizers'],
  properties: {
    version: semverString,
    fingerprint: nullableString,
    sources: { type: 'array', items: riskRuleSchema },
    sinks: { type: 'array', items: riskRuleSchema },
    sanitizers: { type: 'array', items: riskRuleSchema },
    regexConfig: {
      type: ['object', 'null'],
      properties: {
        maxPatternLength: { type: ['integer', 'null'] },
        maxInputLength: { type: ['integer', 'null'] },
        maxProgramSize: { type: ['integer', 'null'] },
        timeoutMs: { type: ['integer', 'null'] },
        flags: nullableString,
        engine: nullableString
      },
      additionalProperties: true
    },
    provenance: {
      type: ['object', 'null'],
      properties: {
        defaults: { type: 'boolean' },
        sourcePath: nullableString
      },
      additionalProperties: true
    },
    diagnostics: {
      type: ['object', 'null'],
      properties: {
        warnings: { type: ['array', 'null'], items: { type: 'object' } },
        errors: { type: ['array', 'null'], items: { type: 'object' } }
      },
      additionalProperties: true
    }
  },
  additionalProperties: true
};

export const ANALYSIS_POLICY_SCHEMA = {
  type: 'object',
  properties: {
    metadata: {
      type: ['object', 'null'],
      properties: {
        enabled: { type: 'boolean' }
      },
      additionalProperties: true
    },
    risk: {
      type: ['object', 'null'],
      properties: {
        enabled: { type: 'boolean' },
        crossFile: { type: 'boolean' }
      },
      additionalProperties: true
    },
    git: {
      type: ['object', 'null'],
      properties: {
        enabled: { type: 'boolean' },
        blame: { type: 'boolean' },
        churn: { type: 'boolean' }
      },
      additionalProperties: true
    },
    typeInference: {
      type: ['object', 'null'],
      properties: {
        local: {
          type: ['object', 'null'],
          properties: {
            enabled: { type: 'boolean' }
          },
          additionalProperties: true
        },
        crossFile: {
          type: ['object', 'null'],
          properties: {
            enabled: { type: 'boolean' }
          },
          additionalProperties: true
        },
        tooling: {
          type: ['object', 'null'],
          properties: {
            enabled: { type: 'boolean' }
          },
          additionalProperties: true
        }
      },
      additionalProperties: true
    }
  },
  additionalProperties: true
};
