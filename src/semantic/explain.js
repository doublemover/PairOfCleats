import { createSemanticTraceService } from './trace.js';
import { assertSemanticExplain } from '../contracts/validators/semantic-explain.js';
/** Explain cited static edges without promoting modeled relationships to observations. */
export const createSemanticExplainService = options => {
  const trace=createSemanticTraceService(options);
  return async input => {
    assertSemanticExplain('request',input.request);
    const result=await trace(input);
    const records=new Map(result.records.map(row=>[JSON.stringify(row.ref),row]));
    result.explanations=result.edges.map(edge=>{
      const evidence=edge.evidence?records.get(JSON.stringify(edge.evidence)):null;
      return {kind:edge.kind,from:edge.from,to:edge.to,evidenceClass:edge.certainty,
        explanation:evidence?.kind==='evidence'?evidence.data.producerId+' '+evidence.data.producerVersion+': '+evidence.data.method:'Evidence reference retained; its record may require the next page or semantic detail.',
        limitations:[...(edge.certainty==='exact-static'?[]:['Static relationship includes modeling or heuristic assumptions.']),
          'This source relationship is not an observed runtime execution or behavioral equivalence.',
          ...(result.coverage.analysis.some(row=>row.state!=='complete')?['Analysis has incomplete frontiers.']:[])]};
    });
    const limit=input.request.limits?.bytes||options?.maxBytes||65536;
    if(Buffer.byteLength(JSON.stringify(result))>limit){
      result.explanations=[];result.warnings.push('Explanation projection omitted to preserve the bounded witness and evidence references.');
      if(Buffer.byteLength(JSON.stringify(result))>limit)throw Object.assign(new Error('Explanation response exceeds byte allowance.'),{code:'ERR_SEMANTIC_OUTPUT_LIMIT'});
    }
    return assertSemanticExplain('result',result);
  };
};
