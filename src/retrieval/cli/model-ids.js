export const resolveModelIds = ({
  modelIdDefault,
  runCode,
  runProse,
  runExtractedProse,
  runRecords,
  idxCode,
  idxProse,
  idxExtractedProse,
  idxRecords
}) => {
  return {
    modelIdForCode: runCode ? (idxCode?.denseVec?.model || modelIdDefault) : null,
    modelIdForProse: runProse ? (idxProse?.denseVec?.model || modelIdDefault) : null,
    modelIdForExtractedProse: runExtractedProse
      ? (idxExtractedProse?.denseVec?.model || modelIdDefault)
      : null,
    modelIdForRecords: runRecords ? (idxRecords?.denseVec?.model || modelIdDefault) : null
  };
};
