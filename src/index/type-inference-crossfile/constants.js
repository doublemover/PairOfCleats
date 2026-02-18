export const FLOW_SOURCE = 'flow';
export const TOOLING_SOURCE = 'tooling';
export const FLOW_CONFIDENCE = 0.55;
export const TOOLING_CONFIDENCE = 0.85;
export const MAX_CANDIDATES_PER_REF = 25;
export const MAX_CANDIDATES_GLOBAL_SCAN = 200;
export const MAX_SYMBOL_ROW_BYTES = 32768;

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

export const RETURN_CALL_RX = /return\s+(?:await\s+)?(?!new\s)(?:&\s*)?([A-Za-z_$][\w$.:]*)\s*\(/g;
export const RETURN_NEW_RX = /return\s+(?:await\s+)?new\s+([A-Za-z_$][\w$.:]*)\s*\(/g;
export const RETURN_BARE_TARGET_RX =
  /^\s*return\s+(?:await\s+)?(?!new\b)(?:&\s*)?([A-Za-z_$][\w$.:!?]*)\b(?!\s*\()/gm;
