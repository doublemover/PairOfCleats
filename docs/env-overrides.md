# Environment Variables

PairOfCleats treats environment variables as secrets-only wiring.

## Supported env vars
- `PAIROFCLEATS_API_TOKEN`: bearer token for service authentication.
- `PAIROFCLEATS_IMPORT_GRAPH=0`: test-only override to disable import resolution debug artifact output.

All other behavior is controlled by CLI flags and `.pairofcleats.json`.
