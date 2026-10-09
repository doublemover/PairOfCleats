import { createHash } from 'node:crypto';

const percentile = (values, fraction) => values.length ? [...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*fraction)] : null;
function vector(value) {
  if (!Array.isArray(value) || !value.length || value.length > 8192 || value.some(v=>typeof v !== 'number' || !Number.isFinite(v))) throw new Error('Finite bounded vector required.');
  const norm = Math.hypot(...value);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid vector norm.');
  return { values: value, norm };
}
function cosine(left,right) {
  if (left.values.length !== right.values.length) throw new Error('Vector dimension mismatch.');
  let sum=0;
  for(let i=0;i<left.values.length;i++)sum+=left.values[i]*right.values[i];
  return sum/(left.norm*right.norm);
}
function entries(values, name) {
  if (!Array.isArray(values) || !values.length || values.length > 10000) throw new Error('Bounded '+name+' required.');
  const result=new Map();
  for(const item of values) {
    if(typeof item.id!=='string'||!item.id||result.has(item.id))throw new Error('Unique '+name+' IDs required.');
    result.set(item.id,{...item,vector:vector(item.vector)});
  }
  return result;
}
function ranking(query,docs,k) {
  return [...docs].map(([id,doc])=>({id,score:cosine(query.vector,doc.vector)}))
    .sort((a,b)=>b.score-a.score||(a.id<b.id?-1:a.id>b.id?1:0)).slice(0,k).map(row=>row.id);
}
function relevanceMetrics(rank, judgments, k) {
  const relevant=Object.entries(judgments).filter(([,grade])=>grade>0);
  if(!relevant.length)return null;
  const found=rank.filter(id=>judgments[id]>0);
  const first=rank.findIndex(id=>judgments[id]>0);
  const dcg=rank.reduce((sum,id,i)=>sum+(2**(judgments[id]??0)-1)/Math.log2(i+2),0);
  const ideal=relevant.map(([,grade])=>grade).sort((a,b)=>b-a).slice(0,k)
    .reduce((sum,grade,i)=>sum+(2**grade-1)/Math.log2(i+2),0);
  return {recallAtK:found.length/relevant.length,mrrAtK:first<0?0:1/(first+1),ndcgAtK:ideal?dcg/ideal:0};
}
const aggregate = rows => {
  const judged=rows.filter(Boolean);
  return judged.length?Object.fromEntries(['recallAtK','mrrAtK','ndcgAtK'].map(key=>[key,judged.reduce((sum,row)=>sum+row[key],0)/judged.length])):null;
};

/** Compare independently paired query/document outputs, not candidate docs under reference queries. */
export function qualifyRetrieval(input) {
  const k=input.k??10;
  if(!Number.isInteger(k)||k<1||k>100)throw new Error('k must be 1..100.');
  const referenceDocs=entries(input.reference?.documents,'reference documents'),candidateDocs=entries(input.candidate?.documents,'candidate documents');
  const referenceQueries=entries(input.reference?.queries,'reference queries'),candidateQueries=entries(input.candidate?.queries,'candidate queries');
  if(referenceDocs.size!==candidateDocs.size||[...referenceDocs.keys()].some(id=>!candidateDocs.has(id)))throw new Error('Candidate document coverage differs.');
  if(referenceQueries.size!==candidateQueries.size||[...referenceQueries.keys()].some(id=>!candidateQueries.has(id)))throw new Error('Candidate query coverage differs.');
  const dimensions=referenceDocs.values().next().value.vector.values.length;
  for(const collection of [referenceDocs,candidateDocs,referenceQueries,candidateQueries])for(const row of collection.values())if(row.vector.values.length!==dimensions)throw new Error('All vectors must share dimensions.');
  if(referenceDocs.size*referenceQueries.size*dimensions>100000000)throw new Error('Qualification comparison work limit exceeded.');
  const drift=[...referenceDocs].map(([id,row])=>1-cosine(row.vector,candidateDocs.get(id).vector));
  const queryDrift=[...referenceQueries].map(([id,row])=>1-cosine(row.vector,candidateQueries.get(id).vector));
  const rows=[];
  for(const [id,query]of referenceQueries) {
    const judgments=input.judgments?.[id]??{};
    for(const [docId,grade]of Object.entries(judgments))if(!referenceDocs.has(docId)||!Number.isInteger(grade)||grade<0||grade>4)throw new Error('Judgments require known documents and grades 0..4.');
    const reference=ranking(query,referenceDocs,k),candidate=ranking(candidateQueries.get(id),candidateDocs,k);
    rows.push({id,reference,candidate,overlapAtK:candidate.filter(key=>reference.includes(key)).length/reference.length,
      referenceMetrics:relevanceMetrics(reference,judgments,k),candidateMetrics:relevanceMetrics(candidate,judgments,k)});
  }
  const norms=[...candidateDocs.values(),...candidateQueries.values()].map(row=>row.vector.norm);
  return {schema:'eg2.retrieval-qualification.v1',documents:referenceDocs.size,queries:referenceQueries.size,dimensions,k,
    norms:{min:Math.min(...norms),max:Math.max(...norms)},documentCosineDrift:{median:percentile(drift,.5),p95:percentile(drift,.95),max:Math.max(...drift)},
    queryCosineDrift:{median:percentile(queryDrift,.5),p95:percentile(queryDrift,.95),max:Math.max(...queryDrift)},
    meanOverlapAtK:rows.reduce((sum,row)=>sum+row.overlapAtK,0)/rows.length,
    judgedQueries:rows.filter(row=>row.candidateMetrics).length,referenceMetrics:aggregate(rows.map(row=>row.referenceMetrics)),
    candidateMetrics:aggregate(rows.map(row=>row.candidateMetrics)),rows,
    acceptance:'No automatic promotion. Product relevance thresholds and held-out judgments required.'};
}

export function summarizeOrtProfile(profile, logs='') {
  const events=Array.isArray(profile)?profile:profile.traceEvents;
  if(!Array.isArray(events)||events.length>1000000)throw new Error('Bounded ORT trace required.');
  const operators={};let nodeDurationUs=0;
  for(const event of events) {
    if(event.cat!=='Node'||!Number.isFinite(event.dur)||event.dur<0||!event.args?.op_name)continue;
    const provider=event.args.provider??'unrecorded',key=provider+'::'+event.args.op_name;
    const row=operators[key]??={provider,operator:event.args.op_name,calls:0,durationUs:0};
    row.calls++;row.durationUs+=event.dur;nodeDurationUs+=event.dur;operators[key]=row;
  }
  // Keep messages private; these are diagnostics, not proof of a particular integer kernel.
  const fallbackMessages=logs.split(/\r?\n/).filter(line=>/matmulnbits|qnbit/i.test(line)&&/unpack|fallback|dequant/i.test(line)).slice(0,100);
  return {schema:'eg2.ort-profile-summary.v1',events:events.length,nodeDurationUs,
    operators:Object.values(operators).sort((a,b)=>b.durationUs-a.durationUs),
    fallbackMessages,logsSha256:createHash('sha256').update(logs).digest('hex'),
    evidence:'Observed profile operator names/providers are not integer-kernel dispatch proof. Absence of fallback logs is inconclusive. Summed node durations may overlap.'};
}
