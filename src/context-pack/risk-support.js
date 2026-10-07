import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MATRIX_DIR = path.resolve(__dirname, '..', '..', 'tests', 'lang', 'matrix');

const SUPPORT_STATES = new Set(['supported', 'partial', 'unsupported']);
const RISK_CAPABILITIES = new Set(['riskLocal', 'riskInterprocedural']);

let cachedRegistry = null;

const normalizeString = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
};

const normalizeState = (value, fallback = 'unsupported') => {
  const normalized = normalizeString(value)?.toLowerCase() || null;
  return normalized && SUPPORT_STATES.has(normalized) ? normalized : fallback;
};

const normalizeArray = (value) => (
  Array.isArray(value)
    ? value.map((entry) => normalizeString(entry)).filter(Boolean)
    : []
);

const buildRowKey = (languageId, frameworkProfile = null) => [
  normalizeString(languageId) || '',
  normalizeString(frameworkProfile) || ''
].join('::');

const readMatrixPayload = (fileName) => {
  const filePath = path.join(MATRIX_DIR, fileName);
  const text = fs.readFileSync(filePath, 'utf8');
  const payload = JSON.parse(text);
  return Array.isArray(payload?.rows) ? payload.rows : [];
};

const loadRegistry = () => {
  try {
    const riskRows = readMatrixPayload('usr-language-risk-profiles.json');
    const frameworkRows = readMatrixPayload('usr-framework-profiles.json');
    const capabilityRows = readMatrixPayload('usr-capability-matrix.json');
    return {
      ok: true,
      riskProfiles: new Map(riskRows.map((row) => [buildRowKey(row?.languageId, row?.frameworkProfile), row])),
      frameworkProfiles: new Map(frameworkRows.map((row) => [normalizeString(row?.id), row])),
      capabilityRowsByKey: capabilityRows.reduce((map, row) => {
        const key = buildRowKey(row?.languageId, row?.frameworkProfile);
        const list = map.get(key) || [];
        list.push(row);
        map.set(key, list);
        return map;
      }, new Map())
    };
  } catch (err) {
    return {
      ok: false,
      error: err,
      riskProfiles: new Map(),
      frameworkProfiles: new Map(),
      capabilityRowsByKey: new Map()
    };
  }
};

const getRegistry = () => {
  if (!cachedRegistry) cachedRegistry = loadRegistry();
  return cachedRegistry;
};

const normalizeCapabilityDiagnostics = (diagnostics, source) => normalizeArray(diagnostics)
  .map((code) => ({
    code,
    source,
    detail: null
  }));

const normalizeUsrCapabilityDiagnostics = (diagnostics) => (Array.isArray(diagnostics) ? diagnostics : [])
  .map((entry) => {
    const code = normalizeString(entry?.code);
    if (!code) return null;
    return {
      code,
      source: 'language-registry',
      reasonCode: normalizeString(entry?.reasonCode),
      detail: normalizeString(entry?.detail)
    };
  })
  .filter(Boolean);

const summarizeLanguageState = ({ riskProfile, usrCapabilities }) => {
  const localState = normalizeState(riskProfile?.capabilities?.riskLocal, normalizeState(usrCapabilities?.state));
  const interproceduralState = normalizeState(riskProfile?.capabilities?.riskInterprocedural, 'unsupported');
  return {
    state: localState,
    capabilities: {
      riskLocal: localState,
      riskInterprocedural: interproceduralState
    }
  };
};

const buildUnsupportedConstructs = (riskProfile) => ({
  sources: normalizeArray(riskProfile?.unsupported?.sources),
  sinks: normalizeArray(riskProfile?.unsupported?.sinks),
  sanitizers: normalizeArray(riskProfile?.unsupported?.sanitizers)
});

const buildLanguageSupportEnvelope = ({
  languageId,
  riskProfile,
  capabilityRows,
  usrCapabilities
}) => {
  const normalizedLanguageId = normalizeString(languageId);
  if (!normalizedLanguageId) {
    return {
      languageId: null,
      state: 'unsupported',
      source: 'fallback',
      capabilities: {
        riskLocal: 'unsupported',
        riskInterprocedural: 'unsupported'
      },
      unsupportedConstructs: {
        sources: [],
        sinks: [],
        sanitizers: []
      },
      diagnostics: [{
        code: 'RISK_LANGUAGE_ID_MISSING',
        source: 'fallback',
        detail: 'Risk summary did not identify a language.'
      }]
    };
  }

  if (!riskProfile && !usrCapabilities) {
    return {
      languageId: normalizedLanguageId,
      state: 'unsupported',
      source: 'fallback',
      capabilities: {
        riskLocal: 'unsupported',
        riskInterprocedural: 'unsupported'
      },
      unsupportedConstructs: {
        sources: [],
        sinks: [],
        sanitizers: []
      },
      diagnostics: [{
        code: 'RISK_LANGUAGE_PROFILE_MISSING',
        source: 'risk-registry',
        detail: `No risk profile is registered for ${normalizedLanguageId}.`
      }]
    };
  }

  const { state, capabilities } = summarizeLanguageState({ riskProfile, usrCapabilities });
  const diagnostics = [
    ...normalizeCapabilityDiagnostics(
      capabilityRows
        .filter((row) => RISK_CAPABILITIES.has(normalizeString(row?.capability)))
        .flatMap((row) => normalizeArray(row?.downgradeDiagnostics)),
      'capability-matrix'
    ),
    ...normalizeUsrCapabilityDiagnostics(usrCapabilities?.diagnostics)
  ];

  return {
    languageId: normalizedLanguageId,
    state,
    source: riskProfile ? 'risk-registry' : 'language-registry',
    capabilities,
    unsupportedConstructs: buildUnsupportedConstructs(riskProfile),
    diagnostics
  };
};

const buildFrameworkSupportEnvelope = ({
  languageId,
  frameworkId,
  frameworkRow,
  riskProfile,
  capabilityRows,
  frameworkProfile
}) => {
  const normalizedFrameworkId = normalizeString(frameworkId);
  if (!normalizedFrameworkId) return null;

  if (!frameworkRow) {
    return {
      frameworkId: normalizedFrameworkId,
      state: 'unsupported',
      source: 'framework-registry',
      appliesToLanguage: false,
      confidence: normalizeString(frameworkProfile?.confidence),
      signals: Object.keys(frameworkProfile?.signals || {}).sort(),
      diagnostics: [{
        code: 'RISK_FRAMEWORK_PROFILE_MISSING',
        source: 'framework-registry',
        detail: `No framework profile is registered for ${normalizedFrameworkId}.`
      }]
    };
  }

  const appliesToLanguage = normalizeArray(frameworkRow?.appliesToLanguages).includes(normalizeString(languageId));
  if (!appliesToLanguage) {
    return {
      frameworkId: normalizedFrameworkId,
      state: 'unsupported',
      source: 'framework-registry',
      appliesToLanguage: false,
      confidence: normalizeString(frameworkProfile?.confidence),
      signals: Object.keys(frameworkProfile?.signals || {}).sort(),
      diagnostics: [{
        code: 'RISK_FRAMEWORK_LANGUAGE_MISMATCH',
        source: 'framework-registry',
        detail: `${normalizedFrameworkId} is not registered for ${languageId || 'unknown language'}.`
      }]
    };
  }

  if (!riskProfile) {
    return {
      frameworkId: normalizedFrameworkId,
      state: 'partial',
      source: 'framework-registry',
      appliesToLanguage: true,
      confidence: normalizeString(frameworkProfile?.confidence),
      signals: Object.keys(frameworkProfile?.signals || {}).sort(),
      diagnostics: [{
        code: 'RISK_FRAMEWORK_BASELINE_ONLY',
        source: 'risk-registry',
        detail: `Framework ${normalizedFrameworkId} is detected, but risk reasoning is using the ${languageId} baseline profile.`
      }]
    };
  }

  const { state } = summarizeLanguageState({ riskProfile, usrCapabilities: null });
  return {
    frameworkId: normalizedFrameworkId,
    state,
    source: capabilityRows.length ? 'capability-matrix' : 'risk-registry',
    appliesToLanguage: true,
    confidence: normalizeString(frameworkProfile?.confidence),
    signals: Object.keys(frameworkProfile?.signals || {}).sort(),
    diagnostics: normalizeCapabilityDiagnostics(
      capabilityRows
        .filter((row) => RISK_CAPABILITIES.has(normalizeString(row?.capability)))
        .flatMap((row) => normalizeArray(row?.downgradeDiagnostics)),
      capabilityRows.length ? 'capability-matrix' : 'risk-registry'
    )
  };
};

const pushUniqueReason = (list, seen, entry) => {
  const code = normalizeString(entry?.code);
  if (!code || seen.has(code)) return;
  seen.add(code);
  list.push(entry);
};

const buildDowngradedReasoningPaths = ({
  language,
  framework,
  analysisStatus,
  stats
}) => {
  const reasons = [];
  const seen = new Set();

  if (language?.capabilities?.riskInterprocedural && language.capabilities.riskInterprocedural !== 'supported') {
    pushUniqueReason(reasons, seen, {
      code: `risk_interprocedural_${language.capabilities.riskInterprocedural}`,
      scope: 'language',
      message: `Interprocedural risk reasoning is ${language.capabilities.riskInterprocedural} for ${language.languageId}.`
    });
  }

  for (const diagnostic of Array.isArray(language?.diagnostics) ? language.diagnostics : []) {
    pushUniqueReason(reasons, seen, {
      code: diagnostic.code,
      scope: 'language',
      message: diagnostic.detail || diagnostic.reasonCode || diagnostic.code
    });
  }

  for (const diagnostic of Array.isArray(framework?.diagnostics) ? framework.diagnostics : []) {
    pushUniqueReason(reasons, seen, {
      code: diagnostic.code,
      scope: 'framework',
      message: diagnostic.detail || diagnostic.code
    });
  }

  if (stats?.effectiveConfig?.summaryOnly === true) {
    pushUniqueReason(reasons, seen, {
      code: 'risk_summary_only',
      scope: 'analysis',
      message: 'Risk pack is using summary-only interprocedural output.'
    });
  }

  for (const degradedReason of normalizeArray(analysisStatus?.degradedReasons)) {
    pushUniqueReason(reasons, seen, {
      code: `risk_degraded_${degradedReason}`,
      scope: 'analysis',
      message: `Risk assembly degraded because of ${degradedReason}.`
    });
  }

  return reasons;
};

export const buildRiskSupportEnvelope = ({
  primaryChunk = null,
  summary = null,
  stats = null,
  analysisStatus = null
} = {}) => {
  const registry = getRegistry();
  const languageId = normalizeString(summary?.languageId)
    || normalizeString(primaryChunk?.lang)
    || normalizeString(primaryChunk?.segment?.languageId);
  const frameworkProfile = primaryChunk?.docmeta?.frameworkProfile && typeof primaryChunk.docmeta.frameworkProfile === 'object'
    ? primaryChunk.docmeta.frameworkProfile
    : null;
  const frameworkId = normalizeString(frameworkProfile?.id);
  const usrCapabilities = primaryChunk?.docmeta?.usrCapabilities && typeof primaryChunk.docmeta.usrCapabilities === 'object'
    ? primaryChunk.docmeta.usrCapabilities
    : null;

  const baseRiskKey = buildRowKey(languageId, null);
  const frameworkRiskKey = buildRowKey(languageId, frameworkId);
  const languageRiskProfile = registry.riskProfiles.get(baseRiskKey) || null;
  const frameworkRiskProfile = frameworkId ? (registry.riskProfiles.get(frameworkRiskKey) || null) : null;
  const baseCapabilityRows = registry.capabilityRowsByKey.get(baseRiskKey) || [];
  const frameworkCapabilityRows = frameworkId ? (registry.capabilityRowsByKey.get(frameworkRiskKey) || []) : [];
  const frameworkRow = frameworkId ? (registry.frameworkProfiles.get(frameworkId) || null) : null;

  const language = buildLanguageSupportEnvelope({
    languageId,
    riskProfile: languageRiskProfile,
    capabilityRows: baseCapabilityRows,
    usrCapabilities
  });
  const framework = buildFrameworkSupportEnvelope({
    languageId,
    frameworkId,
    frameworkRow,
    riskProfile: frameworkRiskProfile,
    capabilityRows: frameworkCapabilityRows,
    frameworkProfile
  });

  return {
    registry: {
      loaded: registry.ok === true,
      languageKey: buildRowKey(languageId, null),
      frameworkKey: frameworkId ? buildRowKey(languageId, frameworkId) : null
    },
    language,
    framework,
    downgradedReasoningPaths: buildDowngradedReasoningPaths({
      language,
      framework,
      analysisStatus,
      stats
    })
  };
};
