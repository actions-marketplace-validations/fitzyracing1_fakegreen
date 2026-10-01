import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lexLine, newLexState } from '../src/lang';

const lex = (s: string, lang: any = 'js', flavor: any = 'c') => lexLine(s, lang, flavor, newLexState());

test('blanks string contents but keeps code', () => {
  const r = lex(`const s = "it.skip('x')"; it('y', fn);`);
  assert.ok(!r.code.includes('skip'));
  assert.ok(r.code.includes("it("));
  assert.ok(r.codeStr.includes('it.skip'));
});

test('separates line and block comments', () => {
  const r = lex('foo(); // @ts-ignore because');
  assert.equal(r.code.trim(), 'foo();');
  assert.match(r.comment, /@ts-ignore/);
  const st = newLexState();
  const a = lexLine('x = 1; /* start', 'js', 'c', st);
  const b = lexLine('still comment it.skip */ y = 2;', 'js', 'c', st);
  assert.equal(a.code.trim(), 'x = 1;');
  assert.ok(!b.code.includes('skip'));
  assert.ok(b.code.includes('y = 2'));
});

test('URLs inside strings are not comments', () => {
  const r = lex(`fetch("https://example.com/x") // real comment`);
  assert.ok(r.code.includes('fetch('));
  assert.equal(r.comment.trim(), 'real comment');
});

test('python comments, strings and triple quotes', () => {
  const r = lex(`x = "# not a comment"  # type: ignore`, 'py', 'py');
  assert.match(r.comment, /type: ignore/);
  assert.ok(!r.code.includes('not a comment'));
  const st = newLexState();
  lexLine('doc = """', 'py', 'py', st);
  const inner = lexLine('@pytest.mark.skip', 'py', 'py', st);
  assert.ok(!inner.code.includes('pytest'));
});

test('rust lifetimes do not open strings', () => {
  const r = lex(`fn f<'a>(x: &'a str) -> bool { cfg!(test) }`, 'rust', 'c');
  assert.ok(r.code.includes('cfg!(test)'));
});

test('hash flavor (yaml/shell) comments', () => {
  const r = lex(`run: npm test || true # TODO`, 'other', 'hash');
  assert.equal(r.code.trim(), 'run: npm test || true');
  const s = lex(`url: "http://x#frag"`, 'other', 'hash');
  assert.equal(s.comment, '');
});

test('JS regex literals are blanked, division is not', () => {
  const r = lex(`const re = /process\\.env\\.NODE_ENV === 'test'/; const x = a / b / c;`);
  assert.ok(!r.code.includes('NODE_ENV'));
  assert.ok(r.code.includes('a / b / c'));
  const k = lex(`if (/it\\.skip\\(/.test(line)) return /[/]x/g;`);
  assert.ok(!k.code.includes('skip'));
  assert.ok(k.code.includes('.test(line)'));
});

test('fakegreen-ignore directives must lead the comment', () => {
  const { findDirective } = require('../src/lang');
  assert.deepEqual(findDirective(' fakegreen-ignore test-skipped -- flaky'), { file: false, rest: ' test-skipped -- flaky' });
  assert.equal(findDirective(' @ts-ignore fakegreen-ignore: upstream types')?.file, false);
  assert.equal(findDirective('* fakegreen-ignore-file: generated')?.file, true);
  assert.equal(findDirective(' Parse the rule list of a fakegreen-ignore directive'), null);
  assert.equal(findDirective(' `fakegreen-ignore-file` seen in the diff'), null);
});
