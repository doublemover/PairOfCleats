import { getCapabilities } from './capabilities.js';
import {
  EDITOR_COMMAND_SPECS,
  RISK_FEATURES,
  RUNTIME_CAPABILITY_MANIFEST_VERSION,
  TUI_SUPERVISOR_CAPABILITY_SPEC,
  cloneJson
} from './runtime-capability-specs.js';
import {
  buildRuntimeCapabilityFlagSets,
  buildRuntimeCapabilitySurfaces
} from './runtime-capability/surfaces.js';

export { RUNTIME_CAPABILITY_MANIFEST_VERSION } from './runtime-capability-specs.js';

export function getRuntimeCapabilityManifest(options = {}) {
  const runtimeCapabilities = options.runtimeCapabilities && typeof options.runtimeCapabilities === 'object'
    ? options.runtimeCapabilities
    : getCapabilities({ refresh: options.refreshCapabilities === true });
  return {
    manifestVersion: RUNTIME_CAPABILITY_MANIFEST_VERSION,
    runtimeCapabilities: cloneJson(runtimeCapabilities),
    riskFeatures: cloneJson(RISK_FEATURES),
    flags: buildRuntimeCapabilityFlagSets(),
    surfaces: buildRuntimeCapabilitySurfaces({
      runtimeCapabilities,
      defaultModelId: options.defaultModelId
    })
  };
}

export function getApiWorkflowCapabilities(options = {}) {
  return getRuntimeCapabilityManifest(options).surfaces.api.workflowCapabilities;
}

export function getTuiSupervisorCapabilities() {
  return cloneJson(TUI_SUPERVISOR_CAPABILITY_SPEC);
}

export function getEditorCommandSpecs() {
  return EDITOR_COMMAND_SPECS.map((entry) => ({ ...entry }));
}
