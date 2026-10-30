/** Canonical structured request classes shared by capability and budget owners. */
export const LSP_STRUCTURED_METHODS = Object.freeze({
  definition: 'textDocument/definition', typeDefinition: 'textDocument/typeDefinition',
  references: 'textDocument/references', documentSymbol: 'textDocument/documentSymbol',
  prepareCallHierarchy: 'textDocument/prepareCallHierarchy', incomingCalls: 'callHierarchy/incomingCalls',
  outgoingCalls: 'callHierarchy/outgoingCalls', prepareTypeHierarchy: 'textDocument/prepareTypeHierarchy',
  supertypes: 'typeHierarchy/supertypes', subtypes: 'typeHierarchy/subtypes'
});
export const LSP_HIERARCHY_REQUEST_CLASSES = Object.freeze([
  'prepareCallHierarchy', 'incomingCalls', 'outgoingCalls', 'prepareTypeHierarchy', 'supertypes', 'subtypes'
]);
export const LSP_OBSERVATION_CONSUMERS = Object.freeze({
  navigation: Object.freeze(['definition', 'typeDefinition', 'references']),
  symbolDetail: Object.freeze(['documentSymbol']),
  hierarchyDetail: LSP_HIERARCHY_REQUEST_CLASSES
});
