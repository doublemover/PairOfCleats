import { resolveLspStartupDocuments } from '../../../integrations/tooling/providers/lsp/path-policy.js';
import {
  formatLspWorkspacePartitionLogLine,
  resolveLspWorkspaceRouting
} from '../lsp-workspace-routing.js';
import { shouldCaptureDiagnosticsForRequestedKinds } from '../provider-contract.js';
import { mergePreflightChecks } from '../preflight/command-profile-preflight.js';
import { resolveGoWorkspaceModulePreflight } from '../preflight/go-workspace-preflight.js';
import { resolveRustWorkspaceMetadataPreflight } from '../preflight/rust-workspace-preflight.js';
import { resolveWorkspaceModelPreflight } from '../preflight/workspace-model-preflight.js';
import { resolveFirstNonReadyPreflight } from './preflight-language.js';

export const prepareConfiguredProviderInputs = ({ providerId, inputs }) => {
  const documents = Array.isArray(inputs?.documents) ? inputs.documents : [];
  const startupSelection = resolveLspStartupDocuments({
    providerId,
    documents,
    captureDiagnostics: shouldCaptureDiagnosticsForRequestedKinds(inputs?.kinds),
    targets: Array.isArray(inputs?.targets) ? inputs.targets : []
  });
  const startupDocuments = startupSelection.documents;
  const startupDocPaths = new Set(
    startupDocuments.map((doc) => String(doc?.virtualPath || '')).filter(Boolean)
  );
  return {
    documents: startupDocuments,
    targets: Array.isArray(inputs?.targets)
      ? inputs.targets.filter((target) => startupDocPaths.has(String(target?.virtualPath || '')))
      : []
  };
};

export const resolveConfiguredWorkspaceRouting = ({
  ctx,
  providerId,
  server,
  docs,
  targets,
  log
}) => {
  const workspaceRouting = resolveLspWorkspaceRouting({
    repoRoot: ctx.repoRoot,
    providerId,
    documents: docs,
    targets,
    workspaceMarkerOptions: server.workspaceMarkerOptions || null,
    requireWorkspaceModel: server.requireWorkspaceModel !== false,
    workspaceModelPolicy: server.workspaceModelPolicy
  });
  if (log) {
    const workspaceLogLine = formatLspWorkspacePartitionLogLine({
      providerId,
      workspaceRouting
    });
    if (workspaceLogLine) log(workspaceLogLine);
  }
  return workspaceRouting;
};

export const resolveConfiguredWorkspacePreflight = async ({
  ctx,
  server,
  providerId,
  inputs,
  commandPreflight,
  languagePreflights
}) => {
  const preflightAbortSignal = inputs?.abortSignal || inputs?.managerAbortSignal || null;
  const documents = Array.isArray(inputs?.documents) ? inputs.documents : [];
  const [
    goWorkspacePreflight,
    rustWorkspacePreflight
  ] = await Promise.all([
    resolveGoWorkspaceModulePreflight({
      ctx,
      server,
      abortSignal: preflightAbortSignal,
      documents
    }),
    resolveRustWorkspaceMetadataPreflight({
      ctx,
      server,
      abortSignal: preflightAbortSignal,
      documents
    })
  ]);

  const checksWithoutWorkspaceModel = mergePreflightChecks(
    languagePreflights?.luaLibraryPreflight?.check,
    languagePreflights?.luaLibraryPreflight?.checks,
    languagePreflights?.luaWorkspaceConfigPreflight?.check,
    languagePreflights?.luaWorkspaceConfigPreflight?.checks,
    languagePreflights?.yamlSchemaModePreflight?.check,
    languagePreflights?.yamlSchemaModePreflight?.checks,
    languagePreflights?.runtimeRequirementPreflight?.check,
    languagePreflights?.runtimeRequirementPreflight?.checks,
    languagePreflights?.rustSuppressionPolicyPreflight?.check,
    languagePreflights?.rustSuppressionPolicyPreflight?.checks,
    languagePreflights?.zigWorkspaceRootPreflight?.check,
    languagePreflights?.zigWorkspaceRootPreflight?.checks,
    goWorkspacePreflight?.check,
    goWorkspacePreflight?.checks,
    rustWorkspacePreflight?.check,
    rustWorkspacePreflight?.checks
  );
  const environmentPreflight = resolveFirstNonReadyPreflight(
    languagePreflights?.luaLibraryPreflight,
    languagePreflights?.luaWorkspaceConfigPreflight,
    languagePreflights?.yamlSchemaModePreflight,
    languagePreflights?.runtimeRequirementPreflight,
    languagePreflights?.rustSuppressionPolicyPreflight,
    languagePreflights?.zigWorkspaceRootPreflight,
    goWorkspacePreflight,
    rustWorkspacePreflight
  );

  if (!(server.workspaceMarkerOptions && server.requireWorkspaceModel !== false)) {
    if (environmentPreflight.state !== 'ready') {
      return {
        ...commandPreflight,
        state: environmentPreflight.state || 'degraded',
        reasonCode: environmentPreflight.reasonCode || null,
        message: environmentPreflight.message || '',
        cached: environmentPreflight.cached === true,
        ...(environmentPreflight?.blockProvider === true ? { blockProvider: true } : {}),
        ...(Array.isArray(environmentPreflight?.blockedWorkspaceKeys)
          ? { blockedWorkspaceKeys: environmentPreflight.blockedWorkspaceKeys.slice() }
          : {}),
        ...(Array.isArray(environmentPreflight?.blockedWorkspaceRoots)
          ? { blockedWorkspaceRoots: environmentPreflight.blockedWorkspaceRoots.slice() }
          : {}),
        ...(checksWithoutWorkspaceModel.length ? { checks: checksWithoutWorkspaceModel } : {})
      };
    }
    return {
      ...commandPreflight,
      cached: environmentPreflight.cached === true,
      ...(checksWithoutWorkspaceModel.length ? { checks: checksWithoutWorkspaceModel } : {})
    };
  }

  const workspacePreflight = resolveWorkspaceModelPreflight({
    repoRoot: ctx?.repoRoot || process.cwd(),
    markerOptions: server.workspaceMarkerOptions || {},
    candidatePaths: documents
      .map((doc) => doc?.virtualPath || doc?.path || '')
      .filter(Boolean),
    missingCheck: {
      name: `${server.id}_workspace_model_missing`,
      message: server.workspaceModelMissingMessage
    },
    fallbackName: `${server.id}_workspace_model_missing`,
    fallbackMessage: server.workspaceModelMissingMessage,
    policy: server.workspaceModelPolicy
  });
  const checks = mergePreflightChecks(
    workspacePreflight?.check,
    workspacePreflight?.checks,
    checksWithoutWorkspaceModel
  );
  if (workspacePreflight.blockProvider === true || workspacePreflight.blockSourcekit === true) {
    return {
      state: 'blocked',
      reasonCode: workspacePreflight.reasonCode || commandPreflight.reasonCode || 'preflight_unknown',
      message: workspacePreflight.message || commandPreflight.message || '',
      blockProvider: true,
      commandProfile: commandPreflight.commandProfile,
      ...(checks.length ? { checks } : {})
    };
  }
  if (environmentPreflight.state !== 'ready') {
    return {
      ...commandPreflight,
      state: environmentPreflight.state || 'degraded',
      reasonCode: environmentPreflight.reasonCode || null,
      message: environmentPreflight.message || '',
      cached: environmentPreflight.cached === true,
      ...(environmentPreflight?.blockProvider === true ? { blockProvider: true } : {}),
      ...(Array.isArray(environmentPreflight?.blockedWorkspaceKeys)
        ? { blockedWorkspaceKeys: environmentPreflight.blockedWorkspaceKeys.slice() }
        : {}),
      ...(Array.isArray(environmentPreflight?.blockedWorkspaceRoots)
        ? { blockedWorkspaceRoots: environmentPreflight.blockedWorkspaceRoots.slice() }
        : {}),
      ...(checks.length ? { checks } : {})
    };
  }
  return {
    state: workspacePreflight.state || 'ready',
    reasonCode: workspacePreflight.reasonCode || commandPreflight.reasonCode || null,
    message: workspacePreflight.message || commandPreflight.message || '',
    cached: environmentPreflight.cached === true,
    commandProfile: commandPreflight.commandProfile,
    ...(checks.length ? { checks } : {})
  };
};
