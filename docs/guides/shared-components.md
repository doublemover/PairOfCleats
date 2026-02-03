# Shared Components

This project centralizes common normalization and formatting helpers to avoid subtle divergence between features. Prefer these helpers over local reimplementations.

Core modules:
- `src/shared/limits.js` for numeric caps and limit normalization.
- `src/shared/provenance.js` for consistent provenance objects and error messaging.
- `src/shared/truncation.js` for recording cap-based truncations once per scope.
- `src/shared/path-normalize.js` for repo-relative and comparison-friendly path normalization.
- `src/shared/seed-ref.js` for parsing `chunk:`, `symbol:`, and `file:` seed references.
- `src/shared/time-format.js` for stable human-readable durations.

Guidelines:
- Keep paths opaque for display/logging and normalize only when comparing or storing.
- Use shared helpers whenever a new feature needs caps, limits, provenance, or path normalization.
- Add tests alongside new shared helpers in `tests/shared/<module>/`.
