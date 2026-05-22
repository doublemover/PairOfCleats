export const createHoverStageCounters = () => ({
  requested: 0,
  succeeded: 0,
  sourceBootstrapUsed: 0,
  hoverTimedOut: 0,
  semanticTokensRequested: 0,
  semanticTokensSucceeded: 0,
  semanticTokensTimedOut: 0,
  signatureHelpRequested: 0,
  signatureHelpSucceeded: 0,
  signatureHelpTimedOut: 0,
  inlayHintsRequested: 0,
  inlayHintsSucceeded: 0,
  inlayHintsTimedOut: 0,
  definitionRequested: 0,
  definitionSucceeded: 0,
  definitionTimedOut: 0,
  typeDefinitionRequested: 0,
  typeDefinitionSucceeded: 0,
  typeDefinitionTimedOut: 0,
  referencesRequested: 0,
  referencesSucceeded: 0,
  referencesTimedOut: 0,
  timedOut: 0
});

export const createHoverSkipCounters = () => ({
  skippedByBudget: 0,
  skippedBySoftDeadline: 0,
  skippedByKind: 0,
  skippedByReturnSufficient: 0,
  skippedByAdaptiveDisable: 0,
  skippedByGlobalDisable: 0
});
