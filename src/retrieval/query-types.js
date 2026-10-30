/** Boolean syntax produced by query.js, before query-specific compilation.
 * Parenthesized nodes retain grouped; implicit conjunction retains implicit.
 * @typedef {({type:'term'|'phrase',value:string,grouped?:boolean}|{type:'not',child:QueryAst,grouped?:boolean}|{type:'and'|'or',left:QueryAst,right:QueryAst,implicit?:boolean,grouped?:boolean})} QueryAst
 */
export {};
