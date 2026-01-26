# `@modelcontextprotocol/sdk`

**Area:** MCP transport / tool integration

## Why this matters for PairOfCleats
Provides the modern MCP transport and protocol helpers for agent integration.

## Implementation notes (practical)
- Keep a legacy transport fallback to avoid breaking older clients.
- Surface capability warnings when the SDK is unavailable.

## Where it typically plugs into PairOfCleats
- MCP server transport selection.

## Deep links (implementation-relevant)
1. README -- https://github.com/modelcontextprotocol/sdk#readme

## Suggested extraction checklist
- [ ] Validate message framing and error handling parity with legacy transport.
- [ ] Ensure clean shutdown on stream close.
