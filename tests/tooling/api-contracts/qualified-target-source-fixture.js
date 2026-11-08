/** Exact original indexed CLI input bytes, shared with the ambient-scope oracle. */
export const qualifiedTargetSources = (language, operation) => {
  const type = language === 'ts' ? ': number' : '';
  return {
    [`a.${language}`]: `export function foo(a${type}) { return a; }\nexport function useA() { return foo(1); }\n`,
    [`b.${language}`]: `export function foo(a${type}, b${type}) { return a+b; }\n${operation === 'violation' ? 'export function useB() { return foo(1); }' : ''}\n`
  };
};
