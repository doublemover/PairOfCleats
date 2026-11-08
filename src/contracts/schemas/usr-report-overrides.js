// Intentional report restrictions, shared by runtime validation and generated docs.
export const USR_REPORT_OVERRIDES = {
  "usr-observability-rollup": {
    "summary": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rowCount",
        "sloBudgetRowCount",
        "alertEvaluationRowCount",
        "batchHotspotRowCount",
        "durationHotspotCount",
        "memoryHotspotCount",
        "parserTimeHotspotCount",
        "passCount",
        "failCount",
        "blockingFailureCount",
        "alertTriggerCount",
        "blockingAlertTriggerCount",
        "warningCount",
        "errorCount"
      ],
      "properties": {
        "rowCount": {
          "type": "integer",
          "minimum": 0
        },
        "sloBudgetRowCount": {
          "type": "integer",
          "minimum": 0
        },
        "alertEvaluationRowCount": {
          "type": "integer",
          "minimum": 0
        },
        "batchHotspotRowCount": {
          "type": "integer",
          "minimum": 0
        },
        "durationHotspotCount": {
          "type": "integer",
          "minimum": 0
        },
        "memoryHotspotCount": {
          "type": "integer",
          "minimum": 0
        },
        "parserTimeHotspotCount": {
          "type": "integer",
          "minimum": 0
        },
        "passCount": {
          "type": "integer",
          "minimum": 0
        },
        "failCount": {
          "type": "integer",
          "minimum": 0
        },
        "blockingFailureCount": {
          "type": "integer",
          "minimum": 0
        },
        "alertTriggerCount": {
          "type": "integer",
          "minimum": 0
        },
        "blockingAlertTriggerCount": {
          "type": "integer",
          "minimum": 0
        },
        "warningCount": {
          "type": "integer",
          "minimum": 0
        },
        "errorCount": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "rows": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "rowType",
              "laneId",
              "scopeId",
              "blocking",
              "pass",
              "errors",
              "warnings"
            ],
            "properties": {
              "rowType": {
                "type": "string",
                "const": "slo-budget"
              },
              "laneId": {
                "type": "string",
                "minLength": 1
              },
              "scopeId": {
                "type": "string",
                "minLength": 1
              },
              "blocking": {
                "type": "boolean"
              },
              "pass": {
                "type": "boolean"
              },
              "errors": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "warnings": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "rowType",
              "id",
              "alertId",
              "laneId",
              "metric",
              "comparator",
              "threshold",
              "observedValue",
              "severity",
              "escalationPolicyId",
              "blocking",
              "triggered",
              "pass",
              "errors",
              "warnings"
            ],
            "properties": {
              "rowType": {
                "type": "string",
                "const": "alert-evaluation"
              },
              "id": {
                "type": "string",
                "minLength": 1
              },
              "alertId": {
                "type": "string",
                "minLength": 1
              },
              "laneId": {
                "type": "string",
                "minLength": 1
              },
              "metric": {
                "type": "string",
                "minLength": 1
              },
              "comparator": {
                "type": "string",
                "enum": [
                  ">",
                  ">=",
                  "<",
                  "<=",
                  "==",
                  "!="
                ]
              },
              "threshold": {
                "type": "number"
              },
              "observedValue": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "severity": {
                "type": "string",
                "minLength": 1
              },
              "escalationPolicyId": {
                "type": "string",
                "minLength": 1
              },
              "blocking": {
                "type": "boolean"
              },
              "triggered": {
                "type": "boolean"
              },
              "pass": {
                "type": "boolean"
              },
              "errors": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "warnings": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "rowType",
              "id",
              "laneId",
              "scopeId",
              "durationMs",
              "peakMemoryMb",
              "parserTimePerSegmentMs",
              "durationRank",
              "memoryRank",
              "parserTimeRank",
              "isDurationHotspot",
              "isMemoryHotspot",
              "isParserTimeHotspot",
              "blocking",
              "pass",
              "errors",
              "warnings"
            ],
            "properties": {
              "rowType": {
                "type": "string",
                "const": "batch-hotspot"
              },
              "id": {
                "type": "string",
                "minLength": 1
              },
              "laneId": {
                "type": "string",
                "minLength": 1
              },
              "scopeId": {
                "type": "string",
                "minLength": 1
              },
              "durationMs": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "peakMemoryMb": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "parserTimePerSegmentMs": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "durationRank": {
                "type": [
                  "integer",
                  "null"
                ],
                "minimum": 1
              },
              "memoryRank": {
                "type": [
                  "integer",
                  "null"
                ],
                "minimum": 1
              },
              "parserTimeRank": {
                "type": [
                  "integer",
                  "null"
                ],
                "minimum": 1
              },
              "isDurationHotspot": {
                "type": "boolean"
              },
              "isMemoryHotspot": {
                "type": "boolean"
              },
              "isParserTimeHotspot": {
                "type": "boolean"
              },
              "blocking": {
                "type": "boolean"
              },
              "pass": {
                "type": "boolean"
              },
              "errors": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "warnings": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            }
          }
        ]
      }
    }
  },
  "usr-operational-readiness-validation": {
    "summary": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "blocked",
        "blockerCount",
        "errorCount",
        "warningCount",
        "rowCount",
        "operationalPhaseRowCount",
        "qualityGateRowCount",
        "readiness",
        "conformanceByLevel"
      ],
      "properties": {
        "blocked": {
          "type": "boolean"
        },
        "blockerCount": {
          "type": "integer",
          "minimum": 0
        },
        "errorCount": {
          "type": "integer",
          "minimum": 0
        },
        "warningCount": {
          "type": "integer",
          "minimum": 0
        },
        "rowCount": {
          "type": "integer",
          "minimum": 0
        },
        "operationalPhaseRowCount": {
          "type": "integer",
          "minimum": 0
        },
        "qualityGateRowCount": {
          "type": "integer",
          "minimum": 0
        },
        "readiness": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "testRolloutBlocked",
            "deepConformanceBlocked",
            "frameworkConformanceBlocked"
          ],
          "properties": {
            "testRolloutBlocked": {
              "type": "boolean"
            },
            "deepConformanceBlocked": {
              "type": "boolean"
            },
            "frameworkConformanceBlocked": {
              "type": "boolean"
            }
          }
        },
        "conformanceByLevel": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "level",
              "requiredProfileCount",
              "failingRequiredProfileCount",
              "errorCount",
              "warningCount",
              "pass"
            ],
            "properties": {
              "level": {
                "type": "string"
              },
              "requiredProfileCount": {
                "type": "integer",
                "minimum": 0
              },
              "failingRequiredProfileCount": {
                "type": "integer",
                "minimum": 0
              },
              "errorCount": {
                "type": "integer",
                "minimum": 0
              },
              "warningCount": {
                "type": "integer",
                "minimum": 0
              },
              "pass": {
                "type": "boolean"
              }
            }
          }
        }
      }
    },
    "rows": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "rowType",
          "id",
          "blocking",
          "pass",
          "errors",
          "warnings"
        ],
        "properties": {
          "rowType": {
            "type": "string",
            "enum": [
              "operational-phase",
              "quality-gate"
            ]
          },
          "id": {
            "type": "string"
          },
          "phase": {
            "type": "string"
          },
          "domain": {
            "type": "string"
          },
          "blocking": {
            "type": "boolean"
          },
          "pass": {
            "type": "boolean"
          },
          "errors": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "warnings": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      }
    }
  },
  "usr-release-readiness-scorecard": {
    "summary": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "blocked",
        "blockerCount",
        "errorCount",
        "warningCount",
        "readiness",
        "conformanceByLevel"
      ],
      "properties": {
        "blocked": {
          "type": "boolean"
        },
        "blockerCount": {
          "type": "integer",
          "minimum": 0
        },
        "errorCount": {
          "type": "integer",
          "minimum": 0
        },
        "warningCount": {
          "type": "integer",
          "minimum": 0
        },
        "readiness": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "testRolloutBlocked",
            "deepConformanceBlocked",
            "frameworkConformanceBlocked"
          ],
          "properties": {
            "testRolloutBlocked": {
              "type": "boolean"
            },
            "deepConformanceBlocked": {
              "type": "boolean"
            },
            "frameworkConformanceBlocked": {
              "type": "boolean"
            }
          }
        },
        "conformanceByLevel": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "level",
              "requiredProfileCount",
              "failingRequiredProfileCount",
              "errorCount",
              "warningCount",
              "pass"
            ],
            "properties": {
              "level": {
                "type": "string"
              },
              "requiredProfileCount": {
                "type": "integer",
                "minimum": 0
              },
              "failingRequiredProfileCount": {
                "type": "integer",
                "minimum": 0
              },
              "errorCount": {
                "type": "integer",
                "minimum": 0
              },
              "warningCount": {
                "type": "integer",
                "minimum": 0
              },
              "pass": {
                "type": "boolean"
              }
            }
          }
        }
      }
    },
    "rows": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "rowType",
              "id",
              "pass",
              "blocked"
            ],
            "properties": {
              "rowType": {
                "type": "string",
                "const": "readiness-dimension"
              },
              "id": {
                "type": "string",
                "enum": [
                  "test-rollout",
                  "deep-conformance",
                  "framework-conformance"
                ]
              },
              "pass": {
                "type": "boolean"
              },
              "blocked": {
                "type": "boolean"
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "rowType",
              "id",
              "pass",
              "requiredProfileCount",
              "failingRequiredProfileCount",
              "errorCount",
              "warningCount"
            ],
            "properties": {
              "rowType": {
                "type": "string",
                "const": "conformance-level"
              },
              "id": {
                "type": "string"
              },
              "pass": {
                "type": "boolean"
              },
              "requiredProfileCount": {
                "type": "integer",
                "minimum": 0
              },
              "failingRequiredProfileCount": {
                "type": "integer",
                "minimum": 0
              },
              "errorCount": {
                "type": "integer",
                "minimum": 0
              },
              "warningCount": {
                "type": "integer",
                "minimum": 0
              }
            }
          }
        ]
      }
    }
  }
};
