# Effective retrieval guardrails in settings

Status: source implementation and authored controls are UNVALIDATED.

Search and settings share `src/retrieval/operational-guardrails.js` for existing
defaults, numeric resolution and ANN min/max/cap plus positive RRF checks. Search
retains its existing exports, defaults, policy precedence and error codes. This
module initializes no backend, provider or index and adds no public configuration
option. These are operational bounds, not latency or retrieval-quality evidence.

Settings inspect and preview first require schema-valid proposed bytes, then
use the existing canonical `loadUserConfig` in-memory repository preview with
the session launch environment. Authority filtering, trusted external source
precedence, normalization and supported testing overlays remain with that loader.
A partial source that the trusted layer completes or overrides is evaluated as
the effective combination. Only privately recognized errors from the shared
guardrail owner become ordinary field diagnostics; other loader failures
propagate. Invalid previews retain the existing rejection/draft behavior and
issue no save token. Default raw-schema config validation is unchanged; the
existing `--effective` mode uses this shared retrieval owner as well.

Save rechecks current effective constraints synchronously after existing final
repository/schema/backup revision checks and before backup or config publication.
A newly conflicting trusted source rejects publication. This is a current input
check, not an atomic snapshot or lock on an independently edited trusted file;
that external source may change again after the check. Existing scope, trust,
sensitive-field, JSONC preservation, confirmation and stale-revision controls stay
in force. Reducing the cap before the maximum, or raising the maximum before the
cap, provides a valid path through ordinary one-field edits without relaxed bounds.

Authored actual settings preview/save and canonical trusted-loader controls cover
default conflicts, inverted bounds, exact boundaries, removal, valid one-field
sequences, trusted completion/override and changed trusted constraints at save.
Existing real search-normalizer controls now compare the pure owner directly,
including policy fallback. All controls are unrun. Native TUI behavior, runtime
readiness, external-file race qualification and final Windows acceptance remain
separate; no measured performance or issue-closure claim is made.
