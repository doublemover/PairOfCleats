const hasProviderCapability = (value) => {
  if (value === true) return true;
  return Boolean(value && typeof value === 'object');
};

const CAPABILITY_KEYS = Object.freeze([
  'documentSymbol',
  'hover',
  'signatureHelp',
  'definition',
  'typeDefinition',
  'references'
]);

const createCapabilityRecord = () => {
  const out = Object.create(null);
  for (const key of CAPABILITY_KEYS) out[key] = false;
  return out;
};

/**
 * Normalize initialize-result capability surface into a deterministic mask.
 *
 * @param {unknown} initializeResult
 * @returns {{
 *   documentSymbol:boolean,
 *   hover:boolean,
 *   signatureHelp:boolean,
 *   definition:boolean,
 *   typeDefinition:boolean,
 *   references:boolean
 * }}
 */
export const probeLspCapabilities = (initializeResult) => {
  const capabilities = initializeResult && typeof initializeResult === 'object'
    ? initializeResult.capabilities
    : null;
  const textDocument = capabilities && typeof capabilities === 'object'
    ? capabilities.textDocument
    : null;
  const mask = createCapabilityRecord();
  mask.documentSymbol = hasProviderCapability(capabilities?.documentSymbolProvider)
    || hasProviderCapability(textDocument?.documentSymbol);
  mask.hover = hasProviderCapability(capabilities?.hoverProvider)
    || hasProviderCapability(textDocument?.hover);
  mask.signatureHelp = hasProviderCapability(capabilities?.signatureHelpProvider)
    || hasProviderCapability(textDocument?.signatureHelp);
  mask.definition = hasProviderCapability(capabilities?.definitionProvider)
    || hasProviderCapability(textDocument?.definition);
  mask.typeDefinition = hasProviderCapability(capabilities?.typeDefinitionProvider)
    || hasProviderCapability(textDocument?.typeDefinition);
  mask.references = hasProviderCapability(capabilities?.referencesProvider)
    || hasProviderCapability(textDocument?.references);
  return mask;
};

export const buildLspCapabilityGate = ({
  capabilityMask,
  cmd,
  hoverEnabled = true,
  signatureHelpEnabled = true,
  definitionEnabled = true,
  typeDefinitionEnabled = true,
  referencesEnabled = true
}) => {
  const command = String(cmd || 'LSP provider');
  const mask = capabilityMask && typeof capabilityMask === 'object'
    ? capabilityMask
    : createCapabilityRecord();
  const requested = createCapabilityRecord();
  requested.documentSymbol = true;
  requested.hover = hoverEnabled !== false;
  requested.signatureHelp = signatureHelpEnabled !== false;
  requested.definition = definitionEnabled !== false;
  requested.typeDefinition = typeDefinitionEnabled !== false;
  requested.references = referencesEnabled !== false;

  const effective = createCapabilityRecord();
  const missing = [];
  const checks = [];

  const addMissing = (key, status, message) => {
    missing.push(key);
    checks.push({
      name: `tooling_capability_missing_${key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)}`,
      status,
      message
    });
  };

  effective.documentSymbol = requested.documentSymbol && mask.documentSymbol;
  if (requested.documentSymbol && !mask.documentSymbol) {
    addMissing('documentSymbol', 'warn', `${command} does not advertise textDocument/documentSymbol; skipping LSP enrichment.`);
  }

  effective.hover = requested.hover && mask.hover;
  if (requested.hover && !mask.hover) {
    addMissing('hover', 'warn', `${command} does not advertise textDocument/hover; hover enrichment disabled.`);
  }

  effective.signatureHelp = requested.signatureHelp && mask.signatureHelp;
  if (requested.signatureHelp && !mask.signatureHelp) {
    addMissing('signatureHelp', 'info', `${command} does not advertise textDocument/signatureHelp.`);
  }

  effective.definition = requested.definition && mask.definition;
  if (requested.definition && !mask.definition) {
    addMissing('definition', 'info', `${command} does not advertise textDocument/definition.`);
  }

  effective.typeDefinition = requested.typeDefinition && mask.typeDefinition;
  if (requested.typeDefinition && !mask.typeDefinition) {
    addMissing('typeDefinition', 'info', `${command} does not advertise textDocument/typeDefinition.`);
  }

  effective.references = requested.references && mask.references;
  if (requested.references && !mask.references) {
    addMissing('references', 'info', `${command} does not advertise textDocument/references.`);
  }

  return {
    capabilities: mask,
    requested,
    effective,
    missing: missing.sort((left, right) => left.localeCompare(right)),
    checks,
    skipSymbolCollection: !effective.documentSymbol
  };
};
