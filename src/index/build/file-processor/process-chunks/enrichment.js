import { buildChunkRelations } from '../../../language-registry.js';
import { detectRiskSignals } from '../../../risk.js';
import { inferTypeMetadata } from '../../../type-inference.js';
import { getStructuralMatchesForChunk } from '../chunk.js';
import { mergeFlowMeta } from '../meta.js';

export const buildChunkEnrichment = ({
  chunkMode,
  text,
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
  totalLines
}) => {
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
      docmeta = mergeFlowMeta(docmeta, flowMeta, { astDataflowEnabled, controlFlowEnabled });
    }
    addEnrichDuration(Date.now() - relationStart);
    if (resolvedTypeInferenceEnabled) {
      const enrichStart = Date.now();
      updateCrashStage('type-inference', { chunkIndex });
      const inferredTypes = inferTypeMetadata({
        docmeta,
        chunkText: text.slice(chunk.start, chunk.end),
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
        text: text.slice(chunk.start, chunk.end),
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

  return { docmeta, codeRelations };
};
