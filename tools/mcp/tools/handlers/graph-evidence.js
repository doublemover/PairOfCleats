export const runGraphEvidenceTool = async (args, context = {}) => {
  const { runGraphEvidence } = await import('../../../../src/integrations/tooling/graph-evidence.js');
  // The retained request owns its exact repository namespace. Generic MCP
  // discovery may prefer an ancestor with a current index, which cannot
  // redirect this explicitly selected build (or its continuation cursor).
  return runGraphEvidence(args, { signal: context.signal });
};
