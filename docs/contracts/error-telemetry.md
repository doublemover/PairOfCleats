# Error Telemetry Contract

PairOfCleats error surfaces (CLI, API, MCP) share a single error-code registry in `src/shared/error-codes.js`.

## Canonical fields

Error payloads should include:

- `code`: canonical enum value (`ERROR_CODES`)
- `namespaceCode`: namespaced identifier (`poc.<lowercase_code>`)
- `message`: user-facing summary
- `hint`: actionable remediation guidance

## Surfaces

- CLI (`bin/pairofcleats.js`) prints `[CODE] message` and `hint: ...` for failures.
- API (`tools/api/response.js`) returns JSON payloads with `ok: false` and canonical fields.
- MCP (`src/integrations/mcp/protocol.js`) returns tool error payloads with canonical fields.

## Validation strategy

Contract assertions live in:

- `tests/cli/error-contract.test.js`
- `tests/services/api/router-smoke.test.js`
- `tests/services/mcp/errors.test.js`
