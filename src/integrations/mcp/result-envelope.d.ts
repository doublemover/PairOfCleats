export type McpToolOutcome =
  | { ok: true; kind: 'success'; result: Record<string, unknown> }
  | { ok: false; kind: 'protocol-error'; code: string; message: string;
      protocolCode: number | null; details: unknown; retryable: boolean }
  | { ok: false; kind: 'tool-error' | 'invalid-response'; code: string; message: string;
      details: unknown; retryable: boolean };
/** Classify an unknown wire/SDK tool response without replaying it. */
export function normalizeMcpToolResponse(response: unknown): McpToolOutcome;
