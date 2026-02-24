# Stage1 Retry and Terminal Outcome Taxonomy

## Purpose
Define retryability classes and deterministic terminalization behavior per `seq`.

## Terminal Outcomes
- `TERMINAL_SUCCESS`
- `TERMINAL_SKIP`
- `TERMINAL_FAIL`
- `TERMINAL_CANCEL`

## Error Classes
- `RETRYABLE_TRANSIENT`
- `RETRYABLE_RESOURCE`
- `NON_RETRYABLE_INPUT`
- `NON_RETRYABLE_SCHEMA`
- `NON_RETRYABLE_CORRUPTION`
- `NON_RETRYABLE_CANCELLATION`

## Retry Contract
1. Retry always reuses the same `seq`.
2. Retry budget is bounded by:
   - `maxRetriesPerSeq`
   - `maxRetriesPerWindow`
3. Backoff is deterministic from attempt number and policy parameters.
4. Exceeded budget transitions to `TERMINAL_FAIL`.

## Terminalization Rules
1. Known unrecoverable class -> immediate `TERMINAL_FAIL`.
2. Cancellation policy paths -> `TERMINAL_CANCEL`.
3. Explicitly skipped entries -> `TERMINAL_SKIP`.
4. Successful compute -> `TERMINAL_SUCCESS`.

## Auditing Fields
Per `seq` terminal record includes:
- `terminalOutcome`
- `errorClass`
- `attempts`
- `reasonCode`
- `finalOwnerId`

## Acceptance
Compliant implementation proves:
1. Retries never create new order slots.
2. Retry budget exhaustion is deterministic.
3. Terminal outcomes are unique and auditable per `seq`.
