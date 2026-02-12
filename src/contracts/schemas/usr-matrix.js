const STRING = { type: 'string' };
const BOOL = { type: 'boolean' };

const stringArray = {
  type: 'array',
  items: STRING
};

const registryEnvelope = (registryId, rowSchema) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: `${registryId}.json`,
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'registryId', 'generatedAt', 'generatedBy', 'rows'],
  properties: {
    schemaVersion: { type: 'string', const: 'usr-registry-1.0.0' },
    registryId: { type: 'string', const: registryId },
    generatedAt: STRING,
    generatedBy: STRING,
    rows: {
      type: 'array',
      items: rowSchema
    }
  }
});

export const USR_MATRIX_ROW_SCHEMAS = Object.freeze({
  'usr-runtime-config-policy': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'key', 'valueType', 'defaultValue', 'rolloutClass', 'strictModeBehavior', 'requiresRestart', 'blocking'],
    properties: {
      id: STRING,
      key: STRING,
      valueType: { type: 'string', enum: ['boolean', 'integer', 'enum'] },
      defaultValue: {},
      minValue: { type: ['number', 'null'] },
      maxValue: { type: ['number', 'null'] },
      allowedValues: {
        type: ['array', 'null'],
        items: STRING
      },
      rolloutClass: STRING,
      strictModeBehavior: STRING,
      requiresRestart: BOOL,
      blocking: BOOL
    }
  },
  'usr-failure-injection-matrix': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'faultClass', 'injectionLayer', 'strictExpectedOutcome', 'nonStrictExpectedOutcome', 'requiredDiagnostics', 'requiredReasonCodes', 'blocking'],
    properties: {
      id: STRING,
      faultClass: STRING,
      injectionLayer: STRING,
      strictExpectedOutcome: STRING,
      nonStrictExpectedOutcome: STRING,
      requiredDiagnostics: stringArray,
      requiredReasonCodes: stringArray,
      blocking: BOOL
    }
  },
  'usr-fixture-governance': {
    type: 'object',
    additionalProperties: false,
    required: ['fixtureId', 'profileType', 'profileId', 'conformanceLevels', 'families', 'owner', 'reviewers', 'stabilityClass', 'mutationPolicy', 'goldenRequired', 'blocking'],
    properties: {
      fixtureId: STRING,
      profileType: { type: 'string', enum: ['language', 'framework', 'cross-cutting'] },
      profileId: STRING,
      conformanceLevels: stringArray,
      families: stringArray,
      owner: STRING,
      reviewers: stringArray,
      stabilityClass: { type: 'string', enum: ['stable', 'volatile'] },
      mutationPolicy: { type: 'string', enum: ['require-rfc', 'require-review', 'allow-generated-refresh'] },
      goldenRequired: BOOL,
      blocking: BOOL
    }
  },
  'usr-language-profiles': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'parserPreference', 'requiredNodeKinds', 'requiredEdgeKinds', 'requiredCapabilities', 'fallbackChain', 'frameworkProfiles', 'requiredConformance'],
    properties: {
      id: STRING,
      parserPreference: STRING,
      languageVersionPolicy: {
        type: 'object',
        additionalProperties: false,
        required: ['minVersion', 'maxVersion', 'dialects', 'featureFlags'],
        properties: {
          minVersion: STRING,
          maxVersion: { type: ['string', 'null'] },
          dialects: stringArray,
          featureFlags: stringArray
        }
      },
      embeddingPolicy: {
        type: 'object',
        additionalProperties: false,
        required: ['canHostEmbedded', 'canBeEmbedded', 'embeddedLanguageAllowlist'],
        properties: {
          canHostEmbedded: BOOL,
          canBeEmbedded: BOOL,
          embeddedLanguageAllowlist: stringArray
        }
      },
      requiredNodeKinds: stringArray,
      requiredEdgeKinds: stringArray,
      requiredCapabilities: {
        type: 'object',
        additionalProperties: {
          type: 'string',
          enum: ['supported', 'partial', 'unsupported']
        }
      },
      fallbackChain: stringArray,
      frameworkProfiles: stringArray,
      requiredConformance: stringArray,
      notes: STRING
    }
  },
  'usr-language-version-policy': {
    type: 'object',
    additionalProperties: false,
    required: ['languageId', 'minVersion', 'maxVersion', 'dialects', 'featureFlags'],
    properties: {
      languageId: STRING,
      minVersion: STRING,
      maxVersion: { type: ['string', 'null'] },
      dialects: stringArray,
      featureFlags: stringArray
    }
  },
  'usr-language-embedding-policy': {
    type: 'object',
    additionalProperties: false,
    required: ['languageId', 'canHostEmbedded', 'canBeEmbedded', 'embeddedLanguageAllowlist'],
    properties: {
      languageId: STRING,
      canHostEmbedded: BOOL,
      canBeEmbedded: BOOL,
      embeddedLanguageAllowlist: stringArray
    }
  },
  'usr-node-kind-mapping': {
    type: 'object',
    additionalProperties: false,
    required: ['languageId', 'parserSource', 'rawKind', 'normalizedKind', 'category', 'confidence', 'priority', 'provenance', 'languageVersionSelector', 'notes'],
    properties: {
      languageId: STRING,
      parserSource: STRING,
      rawKind: STRING,
      normalizedKind: STRING,
      category: STRING,
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      priority: { type: 'integer', minimum: 0 },
      provenance: STRING,
      languageVersionSelector: { type: ['string', 'null'] },
      notes: STRING
    }
  },
  'usr-edge-kind-constraints': {
    type: 'object',
    additionalProperties: false,
    required: ['edgeKind', 'sourceEntityKinds', 'targetEntityKinds', 'requiredAttrs', 'optionalAttrs', 'blocking'],
    properties: {
      edgeKind: STRING,
      sourceEntityKinds: stringArray,
      targetEntityKinds: stringArray,
      requiredAttrs: stringArray,
      optionalAttrs: stringArray,
      blocking: BOOL
    }
  },
  'usr-parser-runtime-lock': {
    type: 'object',
    additionalProperties: false,
    required: ['parserSource', 'languageId', 'parserName', 'parserVersion', 'runtimeName', 'runtimeVersion', 'lockReason'],
    properties: {
      parserSource: STRING,
      languageId: STRING,
      parserName: STRING,
      parserVersion: STRING,
      runtimeName: STRING,
      runtimeVersion: STRING,
      lockReason: STRING
    }
  },
  'usr-language-batch-shards': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'laneId', 'sequence', 'scopeType', 'languageIds', 'dependsOn', 'orderManifest', 'gateId', 'requiredConformance'],
    properties: {
      id: STRING,
      laneId: STRING,
      sequence: { type: 'integer', minimum: 0 },
      scopeType: { type: 'string', enum: ['foundation', 'language-batch', 'integration'] },
      languageIds: stringArray,
      dependsOn: stringArray,
      orderManifest: STRING,
      gateId: STRING,
      requiredConformance: stringArray,
      notes: STRING
    }
  },
  'usr-framework-profiles': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'detectionPrecedence', 'appliesToLanguages', 'segmentationRules', 'bindingSemantics', 'routeSemantics', 'hydrationSemantics', 'embeddedLanguageBridges', 'edgeCaseCaseIds', 'requiredConformance'],
    properties: {
      id: STRING,
      detectionPrecedence: stringArray,
      appliesToLanguages: stringArray,
      segmentationRules: {
        type: 'object',
        additionalProperties: false,
        required: ['blocks', 'ordering', 'crossBlockLinking'],
        properties: {
          blocks: stringArray,
          ordering: stringArray,
          crossBlockLinking: stringArray
        }
      },
      bindingSemantics: {
        type: 'object',
        additionalProperties: false,
        required: ['requiredEdgeKinds', 'requiredAttrs'],
        properties: {
          requiredEdgeKinds: stringArray,
          requiredAttrs: {
            type: 'object',
            additionalProperties: stringArray
          }
        }
      },
      routeSemantics: {
        type: 'object',
        additionalProperties: false,
        required: ['enabled', 'patternCanon', 'runtimeSides'],
        properties: {
          enabled: BOOL,
          patternCanon: STRING,
          runtimeSides: stringArray
        }
      },
      hydrationSemantics: {
        type: 'object',
        additionalProperties: false,
        required: ['required', 'boundarySignals', 'ssrCsrModes'],
        properties: {
          required: BOOL,
          boundarySignals: stringArray,
          ssrCsrModes: stringArray
        }
      },
      embeddedLanguageBridges: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sourceBlock', 'targetBlock', 'edgeKinds'],
          properties: {
            sourceBlock: STRING,
            targetBlock: STRING,
            edgeKinds: stringArray
          }
        }
      },
      edgeCaseCaseIds: stringArray,
      requiredConformance: stringArray
    }
  },
  'usr-framework-edge-cases': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'frameworkProfile', 'category', 'requiredEdgeKinds', 'requiredDiagnostics', 'blocking'],
    properties: {
      id: STRING,
      frameworkProfile: STRING,
      category: STRING,
      requiredEdgeKinds: stringArray,
      requiredDiagnostics: stringArray,
      blocking: BOOL
    }
  },
  'usr-embedding-bridge-cases': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'containerKind', 'sourceLanguageId', 'targetLanguageId', 'requiredEdgeKinds', 'requiredDiagnostics', 'blocking'],
    properties: {
      id: STRING,
      containerKind: STRING,
      sourceLanguageId: STRING,
      targetLanguageId: STRING,
      requiredEdgeKinds: stringArray,
      requiredDiagnostics: stringArray,
      blocking: BOOL
    }
  },
  'usr-generated-provenance-cases': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'languageId', 'generationKind', 'mappingExpectation', 'requiredDiagnostics', 'blocking'],
    properties: {
      id: STRING,
      languageId: STRING,
      generationKind: STRING,
      mappingExpectation: { type: 'string', enum: ['exact', 'approximate', 'missing'] },
      requiredDiagnostics: stringArray,
      blocking: BOOL
    }
  },
  'usr-language-risk-profiles': {
    type: 'object',
    additionalProperties: false,
    required: ['languageId', 'frameworkProfile', 'required', 'optional', 'unsupported', 'capabilities', 'interproceduralGating', 'severityPolicy'],
    properties: {
      languageId: STRING,
      frameworkProfile: { type: ['string', 'null'] },
      required: {
        type: 'object',
        additionalProperties: false,
        required: ['sources', 'sinks', 'sanitizers'],
        properties: {
          sources: stringArray,
          sinks: stringArray,
          sanitizers: stringArray
        }
      },
      optional: {
        type: 'object',
        additionalProperties: false,
        required: ['sources', 'sinks', 'sanitizers'],
        properties: {
          sources: stringArray,
          sinks: stringArray,
          sanitizers: stringArray
        }
      },
      unsupported: {
        type: 'object',
        additionalProperties: false,
        required: ['sources', 'sinks', 'sanitizers'],
        properties: {
          sources: stringArray,
          sinks: stringArray,
          sanitizers: stringArray
        }
      },
      capabilities: {
        type: 'object',
        additionalProperties: false,
        required: ['riskLocal', 'riskInterprocedural'],
        properties: {
          riskLocal: { type: 'string', enum: ['supported', 'partial', 'unsupported'] },
          riskInterprocedural: { type: 'string', enum: ['supported', 'partial', 'unsupported'] }
        }
      },
      interproceduralGating: {
        type: 'object',
        additionalProperties: false,
        required: ['enabledByDefault', 'minEvidenceKinds', 'requiredCallLinkConfidence'],
        properties: {
          enabledByDefault: BOOL,
          minEvidenceKinds: stringArray,
          requiredCallLinkConfidence: { type: 'number', minimum: 0, maximum: 1 }
        }
      },
      severityPolicy: {
        type: 'object',
        additionalProperties: false,
        required: ['levels', 'defaultLevel'],
        properties: {
          levels: stringArray,
          defaultLevel: STRING
        }
      }
    }
  },
  'usr-capability-matrix': {
    type: 'object',
    additionalProperties: false,
    required: ['languageId', 'frameworkProfile', 'capability', 'state', 'requiredConformance', 'downgradeDiagnostics', 'blocking'],
    properties: {
      languageId: STRING,
      frameworkProfile: { type: ['string', 'null'] },
      capability: STRING,
      state: { type: 'string', enum: ['supported', 'partial', 'unsupported'] },
      requiredConformance: stringArray,
      downgradeDiagnostics: stringArray,
      blocking: BOOL
    }
  },
  'usr-conformance-levels': {
    type: 'object',
    additionalProperties: false,
    required: ['profileType', 'profileId', 'requiredLevels', 'blockingLevels', 'requiredFixtureFamilies'],
    properties: {
      profileType: { type: 'string', enum: ['language', 'framework'] },
      profileId: STRING,
      requiredLevels: stringArray,
      blockingLevels: stringArray,
      requiredFixtureFamilies: stringArray
    }
  },
  'usr-backcompat-matrix': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'producerVersion', 'readerVersions', 'readerMode', 'fixtureFamily', 'expectedOutcome', 'requiredDiagnostics', 'blocking'],
    properties: {
      id: STRING,
      producerVersion: STRING,
      readerVersions: stringArray,
      readerMode: { type: 'string', enum: ['strict', 'non-strict'] },
      fixtureFamily: STRING,
      expectedOutcome: { type: 'string', enum: ['accept', 'reject', 'accept-with-adapter'] },
      requiredDiagnostics: stringArray,
      blocking: BOOL
    }
  },
  'usr-ownership-matrix': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'domain', 'ownerRole', 'backupOwnerRole', 'escalationPolicyId', 'evidenceArtifacts', 'blocking'],
    properties: {
      id: STRING,
      domain: STRING,
      ownerRole: STRING,
      backupOwnerRole: STRING,
      escalationPolicyId: STRING,
      evidenceArtifacts: stringArray,
      blocking: BOOL
    }
  },
  'usr-escalation-policy': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'triggerClass', 'severity', 'requiredApprovers', 'maxAckMinutes', 'maxResolutionMinutes', 'autoBlockPromotion'],
    properties: {
      id: STRING,
      triggerClass: STRING,
      severity: { type: 'string', enum: ['medium', 'high', 'critical'] },
      requiredApprovers: stringArray,
      maxAckMinutes: { type: 'integer', minimum: 1 },
      maxResolutionMinutes: { type: 'integer', minimum: 1 },
      autoBlockPromotion: BOOL
    }
  },
  'usr-benchmark-policy': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'laneId', 'datasetClass', 'hostClass', 'warmupRuns', 'measureRuns', 'percentileTargets', 'maxVariancePct', 'maxPeakMemoryMb', 'blocking'],
    properties: {
      id: STRING,
      laneId: STRING,
      datasetClass: STRING,
      hostClass: STRING,
      warmupRuns: { type: 'integer', minimum: 0 },
      measureRuns: { type: 'integer', minimum: 1 },
      percentileTargets: {
        type: 'object',
        additionalProperties: false,
        required: ['p50DurationMs', 'p95DurationMs', 'p99DurationMs'],
        properties: {
          p50DurationMs: { type: 'integer', minimum: 1 },
          p95DurationMs: { type: 'integer', minimum: 1 },
          p99DurationMs: { type: 'integer', minimum: 1 }
        }
      },
      maxVariancePct: { type: 'number', minimum: 0 },
      maxPeakMemoryMb: { type: 'integer', minimum: 1 },
      blocking: BOOL
    }
  },
  'usr-slo-budgets': {
    type: 'object',
    additionalProperties: false,
    required: ['laneId', 'profileScope', 'scopeId', 'maxDurationMs', 'maxMemoryMb', 'maxParserTimePerSegmentMs', 'maxUnknownKindRate', 'maxUnresolvedRate', 'blocking'],
    properties: {
      laneId: STRING,
      profileScope: STRING,
      scopeId: STRING,
      maxDurationMs: { type: 'integer', minimum: 1 },
      maxMemoryMb: { type: 'integer', minimum: 1 },
      maxParserTimePerSegmentMs: { type: 'integer', minimum: 1 },
      maxUnknownKindRate: { type: 'number', minimum: 0, maximum: 1 },
      maxUnresolvedRate: { type: 'number', minimum: 0, maximum: 1 },
      blocking: BOOL
    }
  },
  'usr-security-gates': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'check', 'scope', 'enforcement', 'blocking'],
    properties: {
      id: STRING,
      check: STRING,
      scope: STRING,
      enforcement: STRING,
      blocking: BOOL
    }
  },
  'usr-alert-policies': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'metric', 'threshold', 'comparator', 'window', 'severity', 'escalationPolicyId', 'blocking'],
    properties: {
      id: STRING,
      metric: STRING,
      threshold: { type: 'number' },
      comparator: STRING,
      window: STRING,
      severity: STRING,
      escalationPolicyId: STRING,
      blocking: BOOL
    }
  },
  'usr-redaction-rules': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'class', 'replacement', 'appliesTo', 'blocking'],
    properties: {
      id: STRING,
      class: STRING,
      replacement: STRING,
      appliesTo: stringArray,
      blocking: BOOL
    }
  },
  'usr-quality-gates': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'domain', 'scopeType', 'scopeId', 'metric', 'thresholdOperator', 'thresholdValue', 'fixtureSetId', 'blocking'],
    properties: {
      id: STRING,
      domain: STRING,
      scopeType: { type: 'string', enum: ['global', 'language', 'framework'] },
      scopeId: STRING,
      metric: STRING,
      thresholdOperator: { type: 'string', enum: ['>=', '<=', '>', '<', '=='] },
      thresholdValue: { type: 'number' },
      fixtureSetId: STRING,
      blocking: BOOL
    }
  },
  'usr-operational-readiness-policy': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'phase', 'runbookId', 'severityClass', 'requiredRoles', 'requiredArtifacts', 'communicationChannels', 'maxResponseMinutes', 'maxRecoveryMinutes', 'blocking'],
    properties: {
      id: STRING,
      phase: { type: 'string', enum: ['pre-cutover', 'cutover', 'incident', 'post-cutover'] },
      runbookId: STRING,
      severityClass: STRING,
      requiredRoles: stringArray,
      requiredArtifacts: stringArray,
      communicationChannels: stringArray,
      maxResponseMinutes: { type: 'integer', minimum: 1 },
      maxRecoveryMinutes: { type: 'integer', minimum: 1 },
      blocking: BOOL
    }
  },
  'usr-threat-model-matrix': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'threatClass', 'attackSurface', 'requiredControls', 'requiredFixtures', 'severity', 'blocking'],
    properties: {
      id: STRING,
      threatClass: STRING,
      attackSurface: STRING,
      requiredControls: stringArray,
      requiredFixtures: stringArray,
      severity: { type: 'string', enum: ['medium', 'high', 'critical'] },
      blocking: BOOL
    }
  },
  'usr-waiver-policy': {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'waiverClass', 'scopeType', 'scopeId', 'allowedUntil', 'approvers', 'requiredCompensatingControls', 'maxExtensions', 'blocking'],
    properties: {
      id: STRING,
      waiverClass: STRING,
      scopeType: STRING,
      scopeId: STRING,
      allowedUntil: STRING,
      approvers: stringArray,
      requiredCompensatingControls: stringArray,
      maxExtensions: { type: 'integer', minimum: 0 },
      blocking: BOOL
    }
  }
});

export const USR_MATRIX_SCHEMA_DEFS = Object.freeze(
  Object.fromEntries(
    Object.entries(USR_MATRIX_ROW_SCHEMAS).map(([registryId, rowSchema]) => [registryId, registryEnvelope(registryId, rowSchema)])
  )
);


