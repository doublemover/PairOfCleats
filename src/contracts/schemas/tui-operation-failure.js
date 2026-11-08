import { TUI_OPERATION_FAILURES as catalog } from '../tui-operation-failures.js';

export const TUI_OPERATION_FAILURE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['version', 'reason', 'outcome', 'field', 'diagnosticId', 'actions'],
  oneOf: Object.entries(catalog.reasons).map(([reason, definition]) => ({
    properties: { reason: { const: reason }, outcome: { const: definition.outcome }, actions: { const: definition.actions } }
  })),
  properties: {
    version: { const: catalog.version }, reason: { enum: Object.keys(catalog.reasons) },
    outcome: { enum: [...new Set(Object.values(catalog.reasons).map(row => row.outcome))] },
    field: { anyOf: [{ type: 'null' }, { enum: catalog.fields }] },
    diagnosticId: { type: 'string', pattern: '^tui-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' },
    actions: { type: 'array', maxItems: 4, uniqueItems: true, items: { enum: catalog.actions } }
  }
};
