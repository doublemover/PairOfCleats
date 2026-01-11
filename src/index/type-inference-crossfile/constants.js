export const FLOW_SOURCE = 'flow';
export const TOOLING_SOURCE = 'tooling';
export const FLOW_CONFIDENCE = 0.55;
export const TOOLING_CONFIDENCE = 0.85;

export const TYPE_KIND_PATTERNS = [
  /class/i,
  /struct/i,
  /enum/i,
  /interface/i,
  /protocol/i,
  /trait/i,
  /record/i,
  /type/i
];

export const RETURN_CALL_RX = /return\s+(?:await\s+)?(?!new\s)([A-Za-z_$][\w$.:]*)\s*\(/g;
export const RETURN_NEW_RX = /return\s+(?:await\s+)?new\s+([A-Za-z_$][\w$.:]*)\s*\(/g;
