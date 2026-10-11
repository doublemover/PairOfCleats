import { canonicalSemanticJson } from './identity.js';
export const propertyKeysOverlap=(left,right)=>left===null||right===null ? !(left&&typeof left==='object'||right&&typeof right==='object') : canonicalSemanticJson(left)===canonicalSemanticJson(right);
export const propertyKeySetsOverlap=(left,right)=>left.some(a=>right.some(b=>propertyKeysOverlap(a,b)));
/** Null is a widened property key, distinct from the literal property named "*". */
export const propertyPathsOverlap = (left, right) => {
  const common = Math.min(left.length, right.length);
  for (let i = 0; i < common; i++) if (!propertyKeysOverlap(left[i],right[i])) return false;
  return true;
};
export const compilerPropertyKeys = ({ ts, checker, node, computed = false, reasons }) => {
  if (!node) return [null];
  if (ts.isComputedPropertyName(node)) return compilerPropertyKeys({ ts, checker, node: node.expression, computed: true, reasons });
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isNumericLiteral(node)) return [String(Number(node.text))];
  if (!computed && ts.isIdentifier(node)) return [node.text];
  if (ts.isPrivateIdentifier(node)) {
    const declaration=checker.getSymbolAtLocation(node)?.valueDeclaration;
    let owner=declaration?.parent;while(owner&&!ts.isClassDeclaration(owner)&&!ts.isClassExpression(owner))owner=owner.parent;
    if(owner)return [{private:node.text,source:owner.getSourceFile().fileName,owner:owner.getStart()}];
    reasons.add('private_field_brand_unresolved');return [{private:node.text,source:node.getSourceFile().fileName,owner:node.getStart()}];
  }
  const type = checker.getTypeAtLocation(node), alternatives = type?.isUnion() ? type.types : [type];
  const keys = [];
  for (const alternative of alternatives) {
    if (alternative && alternative.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral)) keys.push(String(alternative.value));
    else { reasons.add('dynamic_field_key_widened'); return [null]; }
    if (keys.length > 16) { reasons.add('field_key_candidate_budget'); return [null]; }
  }
  reasons.add('computed_field_key_type_candidates');
  return [...new Set(keys)];
};
