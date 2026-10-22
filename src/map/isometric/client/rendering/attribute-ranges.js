/** Range ownership stays on the Three attribute until its next renderer upload. */
export const markInstanceRange = (attribute, slot, itemSize, metrics = null) => {
  if(!attribute||!Number.isInteger(slot)||slot<0)return;
  const offset=slot*itemSize;
  if(offset+itemSize>attribute.array.length)throw new Error('Instance update exceeds its resident buffer capacity.');
  if(typeof attribute.addUpdateRange==='function')attribute.addUpdateRange(offset,itemSize);
  attribute.needsUpdate=true;
  if(metrics){metrics.requestedAttributeBytes=(metrics.requestedAttributeBytes||0)+itemSize*attribute.array.BYTES_PER_ELEMENT;metrics.attributeRangeWrites=(metrics.attributeRangeWrites||0)+1;}
};
