import { buildChunkRelations } from '../../../language-registry.js';
import { detectRiskSignals } from '../../../risk.js';
import { inferTypeMetadata } from '../../../type-inference.js';
import { getStructuralMatchesForChunk } from '../chunk.js';
import { mergeFlowMeta, normalizeDocMeta } from '../meta.js';

const normalizeCapabilityDiagnostic = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const code = typeof entry.code === 'string' ? entry.code.trim() : '';
  if (!code) return null;
  const reasonCode = typeof entry.reasonCode === 'string' ? entry.reasonCode.trim() : '';
  const detail = typeof entry.detail === 'string' ? entry.detail.trim() : '';
  return {
    code,
    reasonCode: reasonCode || null,
    detail: detail || null
  };
};

const buildUsrCapabilitiesEnvelope = (activeLang) => {
  const profile = activeLang?.capabilityProfile;
  if (!profile || typeof profile !== 'object') return null;
  const stateRaw = typeof profile.state === 'string' ? profile.state.trim().toLowerCase() : '';
  const state = stateRaw === 'supported' || stateRaw === 'partial' || stateRaw === 'unsupported'
    ? stateRaw
    : 'supported';
  const diagnostics = Array.isArray(profile.diagnostics)
    ? profile.diagnostics.map((entry) => normalizeCapabilityDiagnostic(entry)).filter(Boolean)
    : [];
  if (state === 'supported' && diagnostics.length === 0) return null;
  return {
    state,
    diagnostics,
    source: activeLang?.id || null
  };
};

export const buildChunkEnrichment = ({
  chunkMode,
  text,
  chunkText,
  chunk,
  chunkIndex,
  activeLang,
  activeContext,
  languageOptions,
  fileRelations,
  callIndex,
  relationsEnabled,
  fileStructural,
  chunkLineCount,
  chunkLanguageId,
  resolvedTypeInferenceEnabled,
  resolvedRiskAnalysisEnabled,
  riskConfig,
  astDataflowEnabled,
  controlFlowEnabled,
  addSettingMetric,
  addEnrichDuration,
  updateCrashStage,
  failFile,
  diagnostics,
  startLine,
  endLine,
  totalLines,
  fileFrameworkProfile = null,
  segmentRelationsCache = null
}) => {
  const resolvedChunkText = typeof chunkText === 'string'
    ? chunkText
    : text.slice(chunk.start, chunk.end);
  let codeRelations = {};
  let docmeta = {};
  if (chunkMode === 'code') {
    const relationStart = Date.now();
    try {
      updateCrashStage('docmeta', { chunkIndex, languageId: chunkLanguageId || null });
      docmeta = activeLang && typeof activeLang.extractDocMeta === 'function'
        ? activeLang.extractDocMeta({
          text,
          chunk,
          fileRelations,
          context: activeContext,
          options: languageOptions
        })
        : {};
      docmeta = normalizeDocMeta(docmeta);
    } catch (err) {
      return { skip: failFile('parse-error', 'docmeta', err, diagnostics) };
    }
    if (relationsEnabled && fileRelations) {
      try {
        updateCrashStage('relations', { chunkIndex });
        codeRelations = buildChunkRelations({
          lang: activeLang,
          chunk,
          fileRelations,
          callIndex,
          chunkIndex
        });
      } catch (err) {
        return { skip: failFile('relation-error', 'chunk-relations', err, diagnostics) };
      }
    } else if (relationsEnabled && activeLang && typeof activeLang.buildRelations === 'function') {
      try {
        const segmentId = chunk?.segment?.segmentId || null;
        const cacheKey = segmentId || `${chunkLanguageId || 'unknown'}:${chunk.start}:${chunk.end}`;
        let localRelations = segmentRelationsCache?.get(cacheKey);
        if (!localRelations) {
          localRelations = activeLang.buildRelations({
            text: resolvedChunkText,
            relPath: chunk?.segment?.segmentId || null,
            context: {},
            options: languageOptions
          }) || {};
          if (segmentRelationsCache && cacheKey) {
            segmentRelationsCache.set(cacheKey, localRelations);
          }
        }
        if (Array.isArray(localRelations?.imports) && localRelations.imports.length) {
          codeRelations.imports = localRelations.imports;
        }
        if (Array.isArray(localRelations?.exports) && localRelations.exports.length) {
          codeRelations.exports = localRelations.exports;
        }
        if (Array.isArray(localRelations?.usages) && localRelations.usages.length) {
          codeRelations.usages = localRelations.usages;
        }
        if (Array.isArray(localRelations?.calls) && localRelations.calls.length) {
          codeRelations.calls = chunk?.name
            ? localRelations.calls.filter(([caller]) => caller && caller === chunk.name)
            : localRelations.calls;
        }
        if (Array.isArray(localRelations?.callDetails) && localRelations.callDetails.length) {
          codeRelations.callDetails = chunk?.name
            ? localRelations.callDetails.filter((entry) => entry?.caller === chunk.name)
            : localRelations.callDetails;
        }
      } catch (err) {
        return { skip: failFile('relation-error', 'segment-relations', err, diagnostics) };
      }
    }
    let flowMeta = null;
    if (activeLang && typeof activeLang.flow === 'function') {
      try {
        updateCrashStage('flow', { chunkIndex });
        const flowStart = Date.now();
        flowMeta = activeLang.flow({
          text,
          chunk,
          context: activeContext,
          options: languageOptions
        });
        const flowDurationMs = Date.now() - flowStart;
        if (flowDurationMs > 0) {
          const flowTargets = [];
          if (astDataflowEnabled) flowTargets.push('astDataflow');
          if (controlFlowEnabled) flowTargets.push('controlFlow');
          const flowShareMs = flowTargets.length
            ? flowDurationMs / flowTargets.length
            : 0;
          for (const flowTarget of flowTargets) {
            addSettingMetric(flowTarget, chunkLanguageId, chunkLineCount, flowShareMs);
          }
        }
      } catch (err) {
        return { skip: failFile('relation-error', 'flow', err, diagnostics) };
      }
    }
    if (flowMeta) {
      docmeta = normalizeDocMeta(mergeFlowMeta(docmeta, flowMeta, { astDataflowEnabled, controlFlowEnabled }));
    }
    addEnrichDuration(Date.now() - relationStart);
    if (resolvedTypeInferenceEnabled) {
      const enrichStart = Date.now();
      updateCrashStage('type-inference', { chunkIndex });
      const inferredTypes = inferTypeMetadata({
        docmeta,
        chunkText: resolvedChunkText,
        languageId: chunkLanguageId || null
      });
      if (inferredTypes) {
        docmeta = { ...docmeta, inferredTypes };
      }
      const typeDurationMs = Date.now() - enrichStart;
      addEnrichDuration(typeDurationMs);
      addSettingMetric('typeInference', chunkLanguageId, chunkLineCount, typeDurationMs);
    }
    if (resolvedRiskAnalysisEnabled) {
      const enrichStart = Date.now();
      updateCrashStage('risk-analysis', { chunkIndex });
      const risk = detectRiskSignals({
        text: resolvedChunkText,
        chunk,
        config: riskConfig,
        languageId: chunkLanguageId || null
      });
      if (risk) {
        docmeta = { ...docmeta, risk };
      }
      const riskDurationMs = Date.now() - enrichStart;
      addEnrichDuration(riskDurationMs);
      addSettingMetric('riskAnalysis', chunkLanguageId, chunkLineCount, riskDurationMs);
    }
  }

  if (fileStructural) {
    const structural = getStructuralMatchesForChunk(
      fileStructural,
      startLine,
      endLine,
      totalLines
    );
    if (structural) {
      docmeta = { ...docmeta, structural };
    }
  }

  const usrCapabilities = buildUsrCapabilitiesEnvelope(activeLang);
  if (usrCapabilities) {
    docmeta = {
      ...docmeta,
      usrCapabilities
    };
  }

  const frameworkProfile = fileFrameworkProfile;
  if (frameworkProfile) {
    docmeta = {
      ...docmeta,
      frameworkProfile
    };
  }

  return { docmeta: normalizeDocMeta(docmeta), codeRelations };
};
