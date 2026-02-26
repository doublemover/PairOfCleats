const hasProviderCapability = (value) => {
  if (value === true) return true;
  return Boolean(value && typeof value === 'object');
};

/**
 * Normalize initialize-result capability surface into a deterministic mask.
 *
 * @param {unknown} initializeResult
 * @returns {{
 *   documentSymbol:boolean,
 *   hover:boolean,
 *   signatureHelp:boolean
 * }}
 */
export const probeLspCapabilities = (initializeResult) => {
  const capabilities = initializeResult && typeof initializeResult === 'object'
    ? initializeResult.capabilities
    : null;
  const textDocument = capabilities && typeof capabilities === 'object'
    ? capabilities.textDocument
    : null;
  return {
    documentSymbol: hasProviderCapability(capabilities?.documentSymbolProvider)
      || hasProviderCapability(textDocument?.documentSymbol),
    hover: hasProviderCapability(capabilities?.hoverProvider)
      || hasProviderCapability(textDocument?.hover),
    signatureHelp: hasProviderCapability(capabilities?.signatureHelpProvider)
      || hasProviderCapability(textDocument?.signatureHelp)
  };
};
