import { loadJsonArrayArtifact } from '../../shared/artifact-io.js';
import { addIssue } from './issues.js';
import { validateSchema } from './schema.js';

const normalizeBool = (value) => value === true;

export const validateRiskInterproceduralArtifacts = async ({
  report,
  mode,
  dir,
  manifest,
  strict,
  chunkUidSet,
  indexState,
  readJsonArtifact,
  shouldLoadOptional,
  checkPresence
}) => {
  if (mode !== 'code') return;
  const riskState = indexState?.riskInterprocedural || null;
  if (!riskState) return;

  const emitArtifacts = riskState.emitArtifacts !== 'none';
  const enabled = normalizeBool(riskState.enabled);
  const summaryOnly = normalizeBool(riskState.summaryOnly);

  if (strict && emitArtifacts && enabled) {
    checkPresence('risk_summaries', { required: true });
  }
  if (strict && emitArtifacts && enabled && !summaryOnly) {
    checkPresence('risk_flows', { required: true });
    checkPresence('call_sites', { required: true });
  }
  if (strict) {
    checkPresence('risk_interprocedural_stats', { required: true });
  }

  const stats = readJsonArtifact('risk_interprocedural_stats');
  if (stats) {
    validateSchema(report, mode, 'risk_interprocedural_stats', stats, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
    if (stats.status === 'timed_out') {
      const flowsEmitted = Number(stats.counts?.flowsEmitted || 0);
      const uniqueCallSites = Number(stats.counts?.uniqueCallSitesReferenced || 0);
      if (flowsEmitted !== 0 || uniqueCallSites !== 0) {
        addIssue(report, mode, 'risk interprocedural stats timed_out but flows were emitted');
      }
    }
  }

  if (!emitArtifacts || !enabled) return;

  if (shouldLoadOptional('risk_summaries')) {
    try {
      const summaries = await loadJsonArrayArtifact(dir, 'risk_summaries', { manifest, strict });
      validateSchema(report, mode, 'risk_summaries', summaries, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
    } catch (err) {
      addIssue(report, mode, `risk_summaries load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
    }
  }

  const shouldValidateFlows = !summaryOnly && stats?.status === 'ok';
  if (!shouldValidateFlows) return;

  let callSiteIds = null;
  if (shouldLoadOptional('call_sites')) {
    try {
      const callSites = await loadJsonArrayArtifact(dir, 'call_sites', { manifest, strict });
      callSiteIds = new Set(callSites.map((row) => row?.callSiteId).filter(Boolean));
    } catch (err) {
      addIssue(report, mode, `call_sites load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
    }
  }

  if (shouldLoadOptional('risk_flows')) {
    try {
      const flows = await loadJsonArrayArtifact(dir, 'risk_flows', { manifest, strict });
      validateSchema(report, mode, 'risk_flows', flows, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
      for (const flow of flows) {
        const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
        for (const uid of chunkUids) {
          if (uid && !chunkUidSet.has(uid)) {
            addIssue(report, mode, `risk_flows references unknown chunkUid ${uid}`, 'Rebuild index artifacts for this mode.');
            break;
          }
        }
        if (callSiteIds) {
          const steps = Array.isArray(flow?.path?.callSiteIdsByStep) ? flow.path.callSiteIdsByStep : [];
          for (const step of steps) {
            for (const callSiteId of step || []) {
              if (callSiteId && !callSiteIds.has(callSiteId)) {
                addIssue(report, mode, `risk_flows references missing callSiteId ${callSiteId}`, 'Rebuild index artifacts for this mode.');
                break;
              }
            }
          }
        }
      }
    } catch (err) {
      addIssue(report, mode, `risk_flows load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
    }
  }
};
