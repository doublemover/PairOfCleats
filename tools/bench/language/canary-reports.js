import { atomicWriteJson, atomicWriteText } from '../../../src/shared/io/atomic-write.js';
import { formatBenchRuntimeLiveCanarySummaryMarkdown } from './canaries.js';

/** JSON is the authoritative checkpoint. Each requested report is published
 * through the existing atomic persistence owner after the lane has settled. */
export const publishBenchRuntimeCanarySummary = async (summary, { outJsonPath, outMdPath } = {}) => {
  if (outJsonPath) await atomicWriteJson(outJsonPath, summary, { spaces: 2, newline: true });
  if (outMdPath) await atomicWriteText(outMdPath, formatBenchRuntimeLiveCanarySummaryMarkdown(summary));
};
