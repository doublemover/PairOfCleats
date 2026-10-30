import { normalizeMcpToolResponse } from '../../../src/integrations/mcp/result-envelope.js';
const response: unknown = undefined;
const outcome = normalizeMcpToolResponse(response);
if (outcome.ok) {
  const result: Record<string, unknown> = outcome.result;
  void result;
  // @ts-expect-error successful tool results have no error code
  outcome.code;
} else {
  const code: string = outcome.code;
  const retryable: boolean = outcome.retryable;
  void code; void retryable;
  if (outcome.kind === 'protocol-error') {
    const protocolCode: number | null = outcome.protocolCode;
    void protocolCode;
  } else {
    // @ts-expect-error tool/malformed failures do not invent a protocol code
    outcome.protocolCode;
  }
  // @ts-expect-error failed tool responses have no successful result
  outcome.result;
}
