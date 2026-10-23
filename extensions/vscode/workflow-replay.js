const STRING_FIELDS = new Set(['rulesPath', 'direction', 'seed', 'indexDir', 'chunkUid', 'workspacePath', 'presentationMode']);
const INTEGER_FIELDS = new Set(['depth', 'maxSuggestions', 'hops', 'maxFlows', 'concurrency']);
const SOURCE_FIELDS = new Set(['source', 'repoRoot', 'mode', 'indexDir', 'indexSignature', 'indexCompatKey', 'seed', 'manifestHash']);

function normalizeRiskSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  if (Object.keys(source).some(key => !SOURCE_FIELDS.has(key))) return null;
  if (source.source !== 'context-pack' || source.mode !== 'code') return null;
  const output = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'indexCompatKey' && value === null) output[key] = null;
    else if (typeof value === 'string' && value.length <= 4096 && !value.includes('\0')) output[key] = value;
    else return null;
  }
  return ['repoRoot', 'indexDir', 'indexSignature', 'seed'].every(key => output[key])
    && /^[a-f0-9]{64}$/.test(output.manifestHash || '') ? output : null;
}

// Persist semantic inputs only. Executable paths/argv are historical diagnostics.
function normalizeWorkflowRequest(request) {
  if (!request || request.version !== 1 || typeof request !== 'object') return null;
  if (request.inputContext == null) return { version: 1, inputContext: null };
  const input = request.inputContext;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (STRING_FIELDS.has(key) && typeof value === 'string' && value.length <= 4096 && !value.includes('\0')) {
      output[key] = value;
    } else if (INTEGER_FIELDS.has(key) && Number.isSafeInteger(value) && value > 0) {
      output[key] = value;
    } else if (key === 'changed' && Array.isArray(value) && value.length <= 128
      && value.every(entry => typeof entry === 'string' && entry.length <= 4096 && !entry.includes('\0'))) {
      output[key] = value.slice();
    } else if (key === 'sourceQualification') {
      const source = normalizeRiskSource(value);
      if (!source) return null;
      output[key] = source;
    } else return null;
  }
  if (Buffer.byteLength(JSON.stringify(output)) > 16384) return null;
  return { version: 1, inputContext: output };
}

function hasRequiredWorkflowInput(commandId, input) {
  if (!input || typeof input !== 'object') return false;
  const required = {
    'pairofcleats.architectureCheck': ['rulesPath'],
    'pairofcleats.suggestTests': ['changed', 'maxSuggestions'],
    'pairofcleats.contextPack': ['seed', 'hops'],
    'pairofcleats.riskExplain': ['seed', 'chunkUid', 'indexDir', 'maxFlows', 'sourceQualification'],
    'pairofcleats.workspaceBuild': ['workspacePath', 'concurrency'],
    'pairofcleats.workspaceManifest': ['workspacePath'],
    'pairofcleats.workspaceStatus': ['workspacePath'],
    'pairofcleats.workspaceCatalog': ['workspacePath'],
    'pairofcleats.impact': ['direction', 'depth']
  }[commandId];
  if (!required || !required.every(key => Array.isArray(input[key]) ? input[key].length > 0 : Boolean(input[key]))) return false;
  if (commandId === 'pairofcleats.impact') {
    return ['upstream', 'downstream'].includes(input.direction) && Boolean(input.seed || input.changed?.length);
  }
  return true;
}

module.exports = { normalizeWorkflowRequest, hasRequiredWorkflowInput };
