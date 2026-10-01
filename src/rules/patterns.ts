import { Lang } from '../types';

// All patterns run against lexed code (comments removed, string contents blanked)
// unless noted otherwise. Keep them specific: precision beats recall here.

/** Test-case declarations, per language. */
export const TEST_DECL: Partial<Record<Lang, RegExp[]>> = {
  js: [
    /(?<![\w$.])[xf]?(?:it|test|specify)(?:\.(?:only|skip|each|concurrent|todo|fails|failing|fixme|serial|sequential|skipIf|runIf|if))*\s*[(`]/,
    /\bDeno\.test\s*\(/,
  ],
  py: [/^\s*(?:async\s+)?def\s+test\w*\s*\(/],
  go: [/^\s*func\s+(?:Test(?!Main\b)\w*|Fuzz\w+)\s*\(/, /\bt\.Run\s*\(/],
  rust: [/#\[\s*(?:[\w:]+::)?test\s*[\](]/, /#\[\s*(?:rstest|test_case|quickcheck)\b/],
  java: [/@(?:org\.junit(?:\.jupiter\.api)?\.)?(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b(?![\w.])/],
};

/** Languages whose test declarations may legitimately live in non-test-path files. */
export const INLINE_TEST_LANGS: Lang[] = ['rust', 'java'];

export function countMatches(code: string, res: RegExp[] | undefined): number {
  if (!res) return 0;
  let n = 0;
  for (const r of res) {
    const g = new RegExp(r.source, r.flags.includes('g') ? r.flags : r.flags + 'g');
    n += (code.match(g) || []).length;
  }
  return n;
}

export interface Pat { re: RegExp; label: string }

/** Unconditional skips. */
export const SKIP: Partial<Record<Lang, Pat[]>> = {
  js: [
    { re: /(?<![\w$.])(?:describe|it|test|context|suite|specify)(?:\.(?:describe|serial|parallel|concurrent|each))*\.(?:skip|fixme)\b/, label: '.skip' },
    { re: /(?<![\w$.])x(?:it|describe|test|context|specify)\s*\(/, label: 'x-prefixed test' },
    { re: /\bthis\.skip\s*\(\s*\)/, label: 'this.skip()' },
    { re: /(?<![\w$.])t\.skip\s*\(/, label: 't.skip()' },
  ],
  py: [
    { re: /@pytest\.mark\.skip\b/, label: '@pytest.mark.skip' },
    { re: /@pytest\.mark\.xfail\b/, label: '@pytest.mark.xfail' },
    { re: /\bpytest\.(?:skip|xfail)\s*\(/, label: 'pytest.skip()' },
    { re: /@unittest\.skip\s*(?:\(|$)/, label: '@unittest.skip' },
    { re: /@unittest\.expectedFailure\b/, label: '@unittest.expectedFailure' },
    { re: /\bself\.skipTest\s*\(/, label: 'self.skipTest()' },
    { re: /\braise\s+(?:unittest\.)?SkipTest\b/, label: 'raise SkipTest' },
  ],
  go: [{ re: /\b[tb]\.Skip(?:f|Now)?\s*\(/, label: 't.Skip()' }],
  rust: [{ re: /#\[\s*ignore\b/, label: '#[ignore]' }],
  java: [
    { re: /@(?:org\.junit(?:\.jupiter\.api)?\.)?(?:Disabled|Ignore)\b(?![\w.])/, label: '@Disabled/@Ignore' },
  ],
};

/** Conditional skips: often legitimate, still worth a look. */
export const COND_SKIP: Partial<Record<Lang, Pat[]>> = {
  js: [{ re: /(?<![\w$.])(?:describe|it|test)\.(?:skipIf|runIf)\s*\(/, label: '.skipIf/.runIf' }],
  py: [
    { re: /@pytest\.mark\.skipif\b/, label: '@pytest.mark.skipif' },
    { re: /@unittest\.skip(?:If|Unless)\b/, label: '@unittest.skipIf' },
    { re: /\bpytest\.importorskip\s*\(/, label: 'pytest.importorskip()' },
  ],
  java: [
    { re: /@(?:Disabled|Enabled)(?:If|On|For)\w*\b/, label: '@DisabledIf/@EnabledIf' },
    { re: /\bassume(?:True|False|That|NotNull)\s*\(/, label: 'assumption' },
  ],
};

export const FOCUS: Partial<Record<Lang, Pat[]>> = {
  js: [
    { re: /(?<![\w$.])(?:describe|it|test|context|suite|specify)(?:\.(?:describe|serial|parallel|concurrent|each))*\.only\b/, label: '.only' },
    { re: /(?<![\w$.])f(?:it|describe)\s*\(/, label: 'fit/fdescribe' },
  ],
};

/** Assertion statements. */
export const ASSERT: Partial<Record<Lang, RegExp[]>> = {
  js: [
    /(?<![\w$.])expect\s*\(/,
    /(?<![\w$.])assert(?:\.\w+)*\s*\(/,
    /\.should(?:\.|\()/,
    /(?<![\w$.])t\.(?:is|not|deepEqual|notDeepEqual|true|false|truthy|falsy|throws|throwsAsync|notThrows|equal|strictEqual|ok|notOk|same|match|regex|assert)\s*\(/,
  ],
  py: [
    /^\s*assert\b/,
    /\bself\.assert\w*\s*\(/,
    /\bself\.fail\s*\(/,
    /\bpytest\.raises\s*\(/,
    /\.assert_\w+\s*\(/,
    /\bassert_that\s*\(/,
    /\b(?:np|numpy)\.testing\.assert\w*\s*\(/,
  ],
  go: [/\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(/, /\b(?:assert|require|is|qt)\.\w+\s*\(/],
  rust: [/\b(?:assert|assert_eq|assert_ne|debug_assert|debug_assert_eq|debug_assert_ne|assert_matches|prop_assert|prop_assert_eq)!\s*[([]/],
  java: [/(?<![\w.])assert\w*\s*\(/, /\bAssertions\.assert\w*\s*\(/, /(?<![\w.])verify\s*\(/, /(?<![\w.])fail\s*\(/, /^\s*assert\s/, /\s(?:shouldBe|shouldNotBe|shouldThrow|shouldContain)\b/],
};

/** Strong (specific) assertions, used to detect weakening. */
export const STRONG: Partial<Record<Lang, Pat[]>> = {
  js: [
    { re: /\.(toBe|toEqual|toStrictEqual|toMatchObject|toHaveBeenCalledWith|toHaveBeenCalledTimes|toHaveBeenNthCalledWith|toContain|toContainEqual|toHaveLength|toMatch|toMatchInlineSnapshot|toHaveProperty|toBeCloseTo|toThrow(?:Error)?(?=\s*\(\s*\S)(?!\s*\(\s*\)))\s*\(/, label: '' },
    { re: /\bassert\.(equal|strictEqual|deepEqual|deepStrictEqual|throws|rejects|match|notEqual)\s*\(/, label: '' },
    { re: /\.to\.(?:deep\.)?(equal|eql|have\.length|include|throw)\b/, label: '' },
  ],
  py: [
    { re: /^\s*assert\s+.*(?:==|!=|<=|>=|<|>|\bnot in\b|\bin\b|\bis\s+(?!not\s+None\b)(?!None\b)\w)/, label: '' },
    { re: /\bself\.assert(Equal|Equals|NotEqual|DictEqual|ListEqual|SetEqual|TupleEqual|SequenceEqual|In|NotIn|Raises|RaisesRegex|AlmostEqual|CountEqual|Is|Greater|GreaterEqual|Less|LessEqual|Regex)\s*\(/, label: '' },
    { re: /\bpytest\.raises\s*\(/, label: '' },
  ],
  go: [{ re: /\b(?:assert|require)\.(Equal\w*|Exactly|ErrorIs|ErrorAs|ErrorContains|EqualError|Len|Contains|JSONEq|ElementsMatch|InDelta)\s*\(/, label: '' }],
  rust: [{ re: /\b(assert_eq|assert_ne|assert_matches|prop_assert_eq)!\s*[([]/, label: '' }],
  java: [{ re: /\b(assertEquals|assertArrayEquals|assertSame|assertThrows|assertIterableEquals|assertLinesMatch|isEqualTo|containsExactly|hasSize|isEqualByComparingTo)\s*\(/, label: '' }],
};

/** Weak assertions that pass for almost any value. */
export const WEAK: Partial<Record<Lang, Pat[]>> = {
  js: [
    { re: /\.(toBeTruthy|toBeDefined|toBeFalsy)\s*\(\s*\)/, label: '' },
    { re: /\.not\.(toBeNull|toBeUndefined|toBeNaN)\s*\(\s*\)/, label: '' },
    { re: /\bexpect\.anything\s*\(\s*\)/, label: '' },
    { re: /\.toBeInstanceOf\s*\(\s*Object\s*\)/, label: '' },
    { re: /\bassert(?:\.ok)?\s*\(\s*[\w$.]+\s*\)\s*;?\s*$/, label: '' },
    { re: /\.to\.(?:be\.)?(?:ok|exist|not\.be\.undefined|not\.be\.null)\b/, label: '' },
    { re: /(?<![\w$.])t\.(?:truthy|pass)\s*\(/, label: '' },
  ],
  py: [
    { re: /^\s*assert\s+(?:not\s+)?[\w.]+(?:\(\))?\s*(?:,.*)?$/, label: '' },
    { re: /^\s*assert\s+[\w.\[\]'"()]+\s+is\s+not\s+None\s*(?:,.*)?$/, label: '' },
    { re: /\bself\.assertIsNotNone\s*\(/, label: '' },
    { re: /\bself\.assert(?:True|IsInstance)\s*\(\s*[\w.()]+\s*(?:,\s*\w+\s*)?\)/, label: '' },
  ],
  go: [{ re: /\b(?:assert|require)\.(NotNil|True|NotEmpty|NotZero)\s*\(/, label: '' }],
  rust: [{ re: /\bassert!\s*\(\s*(?:true|[\w.:()]+\.is_(?:ok|some|err|none)\(\)|!?[\w.]+)\s*\)/, label: '' }],
  java: [{ re: /\b(assertNotNull|assertTrue|isNotNull|isNotEmpty)\s*\(\s*[\w.()]*\s*\)/, label: '' }],
};

/** Trivially-true assertions; run against code WITH string literals kept. */
export const TRIVIAL: Partial<Record<Lang, RegExp[]>> = {
  js: [
    /\bexpect\s*\(\s*(true|false|null|undefined|-?\d+(?:\.\d+)?|'[^']*'|"[^"]*")\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)/,
    /\bexpect\s*\(\s*(?:true|1|'[^']+'|"[^"]+")\s*\)\s*\.\s*(?:toBeTruthy|toBeDefined)\s*\(\s*\)/,
    /\bexpect\s*\(\s*(?:false|0|null)\s*\)\s*\.\s*toBeFalsy\s*\(\s*\)/,
    /\bassert(?:\.ok)?\s*\(\s*true\s*\)/,
    /\bassert\.(?:equal|strictEqual|deepEqual|deepStrictEqual)\s*\(\s*(true|false|-?\d+|'[^']*'|"[^"]*")\s*,\s*\1\s*\)/,
    /(?<![\w$.])t\.true\s*\(\s*true\s*\)/,
  ],
  py: [
    /^\s*assert\s+(?:True|1|not\s+False|not\s+None)\s*(?:,.*)?$/,
    /^\s*assert\s+(True|False|None|-?\d+|'[^']*'|"[^"]*")\s*==\s*\1\s*(?:,.*)?$/,
    /\bself\.assertTrue\s*\(\s*(?:True|1)\s*\)/,
    /\bself\.assertFalse\s*\(\s*(?:False|0|None)\s*\)/,
    /\bself\.assertEqual\s*\(\s*(True|False|None|-?\d+|'[^']*'|"[^"]*")\s*,\s*\1\s*\)/,
  ],
  go: [/\b(?:assert|require)\.True\s*\(\s*t\s*,\s*true\s*\)/, /\b(?:assert|require)\.Equal\s*\(\s*t\s*,\s*(-?\d+|"[^"]*"|true)\s*,\s*\1\s*\)/],
  rust: [/\bassert!\s*\(\s*true\s*\)/, /\bassert_eq!\s*\(\s*(true|false|-?\d+|"[^"]*")\s*,\s*\1\s*\)/],
  java: [/\bassertTrue\s*\(\s*true\s*\)/, /\bassertFalse\s*\(\s*false\s*\)/, /\bassertEquals\s*\(\s*(true|false|-?\d+L?|"[^"]*")\s*,\s*\1\s*\)/, /\bassertThat\s*\(\s*true\s*\)\s*\.isTrue\s*\(\s*\)/],
};

/** Commands that run tests / checks. Used for CI weakening and removed-step detection. */
export const CHECK_CMD =
  /(?:\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|tests|lint|typecheck|type-check|check|ci|coverage|e2e|verify)\b(?:[:\w-]*)|\bnpx\s+(?:jest|vitest|mocha|ava|playwright\s+test|cypress\s+run|tsc|eslint)\b|(?<![\w/.-])(?:jest|vitest|mocha|pytest|tox|nox|ctest|rspec|phpunit)\b(?![:=.-])|\bpython3?\s+-m\s+(?:pytest|unittest|mypy|ruff|tox)\b|\bgo\s+(?:test|vet)\b|\bcargo\s+(?:test|nextest|clippy|check)\b|(?<![\w-])(?:mvn|mvnw|\.\/mvnw)\s[^\n]*?(?<![\w!-])(?:test|verify)\b(?![\w-])|(?<![\w-])(?:gradle|gradlew|\.\/gradlew)\s[^\n]*?(?<![\w!-])(?:test|check)\b(?![\w-])|\bmake\s+(?:test|tests|check|lint|ci|verify)\b|(?<![\w/.-])tsc\b(?![:=.-])|(?<![\w/.-])eslint\b(?![:=.-])|(?<![\w/.-])ruff\s+check\b|(?<![\w/.-])(?:mypy|pyright|flake8|pylint|golangci-lint)\b(?![:=.-])|\bdeno\s+(?:test|lint|check)\b|\bdotnet\s+test\b|\bbazel\s+test\b)/;
