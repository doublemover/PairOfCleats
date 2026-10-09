// Authoritative read-only agent request schemas; no access grants.
export const HISTORY_AGENT_REQUESTS = {
  "search": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "query"
    ],
    "properties": {
      "match": {"enum":["strict","relaxed","auto"],"default":"auto"},
      "query": {
        "type": "string",
        "minLength": 1,
        "maxLength": 4096
      },
      "top": {
        "type": "integer",
        "minimum": 1,
        "maximum": 100,
        "default": 5
      },
      "offset": {
        "type": "integer",
        "minimum": 0,
        "maximum": 100000,
        "default": 0
      },
      "snippetChars": {
        "type": "integer",
        "minimum": 80,
        "maximum": 2000,
        "default": 600
      },
      "role": {
        "enum": [
          "user",
          "assistant"
        ]
      },
      "dateFrom": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z)?$",
        "description": "Inclusive UTC bound; actual calendar validity checked by adapter."
      },
      "dateTo": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z)?$",
        "description": "Inclusive UTC bound; actual calendar validity checked by adapter."
      },
      "pathState": {
        "enum": [
          "all",
          "on_selected_path",
          "off_selected_path",
          "unknown"
        ],
        "default": "all"
      },
      "includeHistory": {
        "type": "boolean",
        "default": false
      },
      "snapshotRef": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      }
    }
  },
  "context": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "sourceRef",
      "snapshotRef"
    ],
    "properties": {
      "sourceRef": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "snapshotRef": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "before": {
        "type": "integer",
        "minimum": 0,
        "maximum": 10,
        "default": 2
      },
      "after": {
        "type": "integer",
        "minimum": 0,
        "maximum": 10,
        "default": 2
      },
      "top": {
        "type": "integer",
        "minimum": 1,
        "maximum": 20,
        "default": 5
      },
      "messageChars": {
        "type": "integer",
        "minimum": 80,
        "maximum": 4000,
        "default": 1200
      },
      "offset": {
        "type": "integer",
        "minimum": 0,
        "maximum": 10000
      }
    }
  },
  "references": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "sourceRef"
    ],
    "properties": {
      "sourceRef": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "top": {
        "type": "integer",
        "minimum": 1,
        "maximum": 50,
        "default": 5
      },
      "offset": {
        "type": "integer",
        "minimum": 0,
        "maximum": 100000,
        "default": 0
      }
    }
  },
  "original": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "snapshotRef"
    ],
    "properties": {
      "snapshotRef": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      }
    }
  },
  "member": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "importRef",
      "member"
    ],
    "properties": {
      "importRef": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "member": {
        "type": "string",
        "minLength": 1,
        "maxLength": 4096
      }
    }
  }
};

for (const schema of Object.values(HISTORY_AGENT_REQUESTS)) schema.properties.expectedGeneration = {type:"string",pattern:"^[a-f0-9]{64}$"};

HISTORY_AGENT_REQUESTS.timeline = {
  type: 'object', additionalProperties: false, required: ['sourceRef','snapshotRef'],
  properties: {
    sourceRef: {type:'string',pattern:'^[a-f0-9]{64}$'}, snapshotRef: {type:'string',pattern:'^[a-f0-9]{64}$'},
    expectedGeneration: {type:'string',pattern:'^[a-f0-9]{64}$'},
    top: {type:'integer',minimum:1,maximum:20,default:10},
    offset: {type:'integer',minimum:0,maximum:10000,default:0},
    messageChars: {type:'integer',minimum:80,maximum:4000,default:1200},
    role: {enum:['user','assistant']}, order: {enum:['oldest','newest'],default:'oldest'},
    dateFrom: {...HISTORY_AGENT_REQUESTS.search.properties.dateFrom},
    dateTo: {...HISTORY_AGENT_REQUESTS.search.properties.dateTo}
  }
};

Object.assign(HISTORY_AGENT_REQUESTS.search.properties,{
  mode:{enum:['auto','lexical','hybrid','semantic'],default:'auto'},
  candidateLimit:{type:'integer',minimum:1,maximum:100,default:50},
  rankConstant:{type:'integer',minimum:1,maximum:10000,default:60},
  lexicalWeight:{type:'integer',minimum:0,maximum:100,default:1},
  semanticWeight:{type:'integer',minimum:0,maximum:100,default:1},
  maxPerConversation:{type:'integer',minimum:1,maximum:100},
  rerank:{type:'boolean',default:false}
});
