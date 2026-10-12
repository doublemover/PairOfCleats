import { canonicalSemanticJson } from './identity.js';
export const compilerRuntimeParameters = (ts, owner) => (owner?.parameters || [])
  .filter(parameter => !(ts.isIdentifier(parameter.name) && parameter.name.text === 'this'));
/** Runtime parameter positions and source operand positions are different for tags. */
export const compilerInvocationInputs = (ts, node) => {
  if (node && ts.isTaggedTemplateExpression(node)) {
    const argumentsList = ts.isTemplateExpression(node.template) ? node.template.templateSpans.map(span => span.expression) : [];
    return { inputs: argumentsList.map((argument, operandOrdinal) => ({ argument, operandOrdinal, parameterOrdinal: operandOrdinal + 1 })),
      runtimeArguments: [null, ...argumentsList], implicitTemplateObject: true };
  }
  const argumentsList = [...(node?.arguments || [])];
  return { inputs: argumentsList.map((argument, ordinal) => ({ argument, operandOrdinal: ordinal, parameterOrdinal: ordinal })),
    runtimeArguments: argumentsList, implicitTemplateObject: false };
};
/** A chosen overload/signature must not collapse callable union alternatives. */
export const compilerInvocationTargets = ({ ts, checker, node, signature, declarationRef, targets, dispatch = null, adapter = null }) => {
  const callee = adapter?.callee || node.expression || node.tag;
  const type = callee && checker.getTypeAtLocation(callee);
  let incomplete = false, candidates = targets;
  if (type?.isUnion() || adapter) {
    candidates = [];
    const kind = ts.isNewExpression(node) ? ts.SignatureKind.Construct : ts.SignatureKind.Call;
    for (const alternative of type?.isUnion() ? type.types : type ? [type] : []) {
      const signatures = checker.getSignaturesOfType(alternative, kind);
      if (!signatures.length) incomplete = true;
      for (const candidate of signatures) {
        const target = candidate.declaration && declarationRef(candidate.declaration);
        if (target) candidates.push(target); else incomplete = true;
      }
    }
  } else if (signature?.declaration && !targets.length) candidates = [declarationRef(signature.declaration)].filter(Boolean);
  const resolved = dispatch?.(adapter ? { ...node, expression: callee } : node);
  let certainty = 'exact-static', reasons = [];
  if(resolved) {
    if(resolved.targets.length) candidates = resolved.propertyDispatch ? [...candidates,...resolved.targets] : resolved.targets;
    const excluded=new Set(resolved.excludedTargets.map(canonicalSemanticJson));
    candidates=candidates.filter(target=>!excluded.has(canonicalSemanticJson(target)));
    incomplete ||= resolved.incomplete;
    if(resolved.modeled || resolved.incomplete) certainty='modeled';
    reasons=resolved.reasons;
  }
  if (adapter) { incomplete = true; certainty = 'modeled'; reasons = [...reasons, ...adapter.reasons]; }
  const unique = [...new Map(candidates.map(target => [canonicalSemanticJson(target), target])).values()];
  return { targets: unique, incomplete, certainty, reasons, parameterMappingAllowed: unique.length === 1 && !incomplete && certainty === 'exact-static' };
};
