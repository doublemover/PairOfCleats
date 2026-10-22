import assert from 'node:assert/strict';
import { buildTreeSitterChunks } from '../../../src/lang/tree-sitter/chunking.js';
import { preflightNativeTreeSitterGrammars } from '../../../src/lang/tree-sitter/native-runtime.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const options = { treeSitter: { enabled:true,strict:true,adaptive:false,chunkCache:false } };
const languages = ['csharp','dart','julia','go','swift','kotlin','clike','objc','rust','java','cpp','python'];
assert.equal(preflightNativeTreeSitterGrammars(languages).ok, true);
const check = (languageId, text, expected, absent = []) => {
  for (const useQueries of [false,true]) {
    const chunks = buildTreeSitterChunks({ text,languageId,options:{treeSitter:{...options.treeSitter,useQueries}} });
    assert.ok(chunks?.length, languageId);
    for (const [name,kind,contains] of expected) {
      const found = chunks.filter(chunk => chunk.name === name && (!kind || chunk.kind === kind));
      assert.equal(found.length, 1, `${languageId} ${name} ${kind}: ${JSON.stringify(chunks.map(c => [c.name,c.kind]))}`);
      if (contains) assert.ok(text.slice(found[0].start,found[0].end).includes(contains), `${name} complete source`);
    }
    for (const name of absent) assert.equal(chunks.some(chunk => chunk.name === name), false, `${languageId} excludes ${name}`);
  }
};
check('csharp','class Widget {} class Service { Widget Make(){return new Widget();} Widget Other(){return new Widget();} int Count(){return 1;} Widget Value {get;set;} Service(){} }\n',
  [['Service.Make','MethodDeclaration'],['Service.Other','MethodDeclaration'],['Service.Value','PropertyDeclaration'],['Service.Count','MethodDeclaration'],['Service.Service','ConstructorDeclaration']],['Service.Widget']);
check('dart','int top(int x) { return x + 1; }\nint next(int x) => x + 3;\nclass Counter { int add(int x) { return x + 2; } }\n',
  [['top','FunctionDeclaration','return x + 1;'],['next','FunctionDeclaration','=> x + 3;'],['Counter.add','MethodDeclaration','return x + 2;']],['Counter.int']);
check('julia','function mutate!(x)\n x + 1\nend\nfunction mutate(x)\n x\nend\nmacro change!(x)\n x\nend\n',
  [['mutate!','FunctionDeclaration'],['mutate','FunctionDeclaration'],['change!','MacroDeclaration']]);
check('go','package p\ntype (\n First struct { X int }\n Second interface { Run() }\n)\ntype Alias = First\nfunc Run() {}\n',
  [['First','StructDeclaration'],['Second','InterfaceDeclaration'],['Alias','TypeAlias'],['Run','FunctionDeclaration']]);
check('swift','public struct Public {}\nenum Mode {case one}\nactor Worker {}\nclass Box { init() {} deinit {} subscript(i:Int)->Int{return i} func normal(){} }\n',
  [['Public','StructDeclaration'],['Mode','EnumDeclaration'],['Worker','ActorDeclaration'],['Box.init','Initializer'],['Box.deinit','Deinitializer'],['Box.subscript','SubscriptDeclaration'],['Box.normal','MethodDeclaration']],['Box.i']);
check('kotlin','interface Greeter { fun hello(): String }\nenum class Color { RED, BLUE }\nclass Box { constructor() {} fun normal() {} }\n',
  [['Greeter','InterfaceDeclaration'],['Greeter.hello','MethodDeclaration'],['Color','EnumDeclaration'],['Box.constructor','ConstructorDeclaration'],['Box.normal','MethodDeclaration']],['RED']);
check('clike','typedef int Count; struct Item {int x;}; struct Future; Count getCount(void){return 1;} Count otherCount(void){return 2;} void consume(struct Item *item){struct Item local;} int external(int value); int (*callback)(int);\n',
  [['Item','StructDeclaration'],['Future','StructDeclaration'],['getCount','FunctionDeclaration'],['otherCount','FunctionDeclaration'],['consume','FunctionDeclaration'],['external','FunctionDeclaration']],['Count','callback']);
check('objc','@interface Box\n- (int)add:(int)x to:(int)y;\n- (int)add:(int)x from:(int)y;\n@end\n@implementation Other\n- (int)add:(int)x to:(int)y {return x+y;}\n+ (int)plain {return 1;}\n@end\n',
  [['Box.-add:to:','MethodDeclaration'],['Box.-add:from:','MethodDeclaration'],['Other.-add:to:','MethodDeclaration'],['Other.+plain','MethodDeclaration']]);
check('rust','mod api {pub fn ping() {} fn outer() {fn helper() {} helper();}}\nstruct S; impl S {fn run(&self) {fn helper() {}}}\ntrait Service {fn required(&self); fn normal(&self) {}}\nextern "C" {fn external(x:i32)->i32;}\n',
  [['api.ping','FunctionDeclaration'],['api.outer.helper','FunctionDeclaration'],['S.run','MethodDeclaration'],['S.run.helper','FunctionDeclaration'],['Service.required','MethodDeclaration'],['external','FunctionDeclaration']]);
check('java','class First {class Inner {void same(){}}} class Second {class Inner {void same(){}}} record Point(int x) {Point {if(x<0) throw new IllegalArgumentException();}} @interface Label {String value();}\n',
  [['First.Inner','ClassDeclaration'],['First.Inner.same','MethodDeclaration'],['Second.Inner.same','MethodDeclaration'],['Point.Point','ConstructorDeclaration'],['Label','AnnotationDeclaration'],['Label.value','MethodDeclaration']]);
check('cpp','namespace outer {namespace inner {int deep(){return 3;}}}\nclass A {}; class B {}; int A::same(){return 1;} int B::same(){return 2;} class Box {public: int operator()() const{return 1;} operator bool() const{return true;} int method(int x); int field;};\n',
  [['outer.inner','NamespaceDeclaration'],['outer.inner.deep','FunctionDeclaration'],['A.same','FunctionDeclaration'],['B.same','FunctionDeclaration'],['Box.operator()','MethodDeclaration'],['Box.operator bool','MethodDeclaration'],['Box.method','MethodDeclaration']],['Box.field']);
check('python','class C:\n def method(self):\n  def helper():\n   return 1\n  return helper()\n',
  [['C.method','MethodDeclaration'],['C.method.helper','FunctionDeclaration']]);
for (const [languageId,text,name,prefix] of [
  ['python','@route("/unique")\ndef status():\n return 1\n','status','@route'],
  ['rust','#[cfg(target_os="linux")]\npub fn ping() {}\n','ping','#[cfg'],
  ['cpp','template <typename T>\nT identity(T value){return value;}\n','identity','template']]) {
  const chunks = buildTreeSitterChunks({text,languageId,options});
  const chunk = chunks.find(row => row.name === name);
  assert.ok(text.slice(chunk.start,chunk.end).startsWith(prefix));
  assert.equal(chunk.meta.startLine,1); assert.equal(chunk.meta.definitionStartLine,2);
}
console.log('native declaration role, source and lexical scope contracts passed');