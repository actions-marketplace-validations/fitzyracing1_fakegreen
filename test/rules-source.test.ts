import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ids, scanEdit } from './helpers';

const TS = 'export function charge(amount: number) {\n  return gateway.charge(amount);\n}\n';

describe('test-env-special-case', () => {
  test('NODE_ENV === "test" in source is high', () => {
    const f = scanEdit('src/pay.ts', TS, TS.replace('  return', "  if (process.env.NODE_ENV === 'test') return { ok: true };\n  return"));
    assert.deepEqual(ids(f), ['test-env-special-case']);
    assert.equal(f[0].severity, 'high');
  });
  test('JEST_WORKER_ID / typeof jest', () => {
    assert.deepEqual(ids(scanEdit('src/pay.ts', TS, TS.replace('  return', '  if (process.env.JEST_WORKER_ID) return null;\n  return'))), ['test-env-special-case']);
    assert.deepEqual(ids(scanEdit('src/pay.ts', TS, TS.replace('  return', "  if (typeof jest !== 'undefined') return null;\n  return"))), ['test-env-special-case']);
  });
  test('CI checks are medium; in tooling/config files they are demoted', () => {
    const f = scanEdit('src/pay.ts', TS, TS.replace('  return', '  if (process.env.CI) return null;\n  return'));
    assert.equal(f[0].severity, 'medium');
    const cfg = 'export default {\n  retries: 0,\n};\n';
    const g = scanEdit('playwright.config.ts', cfg, cfg.replace('retries: 0', 'retries: process.env.CI ? 2 : 0'));
    assert.equal(g[0].severity, 'low');
  });
  test('same checks inside test files are fine', () => {
    const t = "it('x', () => {\n  expect(1).toBe(1);\n});\n";
    assert.deepEqual(ids(scanEdit('src/pay.test.ts', t, "if (process.env.CI) jest.setTimeout(30000);\n" + t)), []);
  });
  test('NODE_ENV === "production" is not test special-casing', () => {
    assert.deepEqual(ids(scanEdit('src/pay.ts', TS, TS.replace('  return', "  if (process.env.NODE_ENV === 'production') log();\n  return"))), []);
  });
  test('python, go, rust variants', () => {
    const py = 'def charge(amount):\n    return gateway.charge(amount)\n';
    assert.deepEqual(ids(scanEdit('app/pay.py', py, py.replace('    return', '    if "pytest" in sys.modules:\n        return True\n    return'))), ['test-env-special-case']);
    assert.deepEqual(ids(scanEdit('app/pay.py', py, py.replace('    return', '    if os.environ.get("TESTING"):\n        return True\n    return'))), ['test-env-special-case']);
    const go = 'package pay\n\nfunc Charge() error {\n\treturn gateway.Charge()\n}\n';
    assert.deepEqual(ids(scanEdit('pay/pay.go', go, go.replace('\treturn', '\tif testing.Testing() {\n\t\treturn nil\n\t}\n\treturn'))), ['test-env-special-case']);
    const rs = 'pub fn charge() -> bool {\n    gateway::charge()\n}\n';
    assert.deepEqual(ids(scanEdit('src/pay.rs', rs, rs.replace('    gateway', '    if cfg!(test) { return true; }\n    gateway'))), ['test-env-special-case']);
  });
  test('#[cfg(test)] modules in rust are not special-casing', () => {
    const rs = 'pub fn f() -> u8 { 1 }\n';
    assert.deepEqual(ids(scanEdit('src/lib.rs', rs, rs + '#[cfg(test)]\nmod tests {\n    #[test]\n    fn t() { assert_eq!(super::f(), 1); }\n}\n')), []);
  });
});

describe('error-swallowed', () => {
  test('empty catch (single and multi line)', () => {
    const one = scanEdit('src/pay.ts', TS, TS.replace('  return gateway.charge(amount);', '  try { return gateway.charge(amount); } catch (e) {}'));
    assert.deepEqual(ids(one), ['error-swallowed']);
    const multi = scanEdit('src/pay.ts', TS, TS.replace('  return gateway.charge(amount);', '  try {\n    return gateway.charge(amount);\n  } catch {\n  }'));
    assert.deepEqual(ids(multi), ['error-swallowed']);
    assert.equal(multi[0].severity, 'medium');
  });
  test('catch with a comment is low; catch that handles the error is fine', () => {
    const c = scanEdit('src/pay.ts', TS, TS.replace('  return gateway.charge(amount);', '  try {\n    return gateway.charge(amount);\n  } catch {\n    // best effort\n  }'));
    assert.equal(c[0].severity, 'low');
    const ok = scanEdit('src/pay.ts', TS, TS.replace('  return gateway.charge(amount);', '  try {\n    return gateway.charge(amount);\n  } catch (e) {\n    log(e);\n    throw e;\n  }'));
    assert.deepEqual(ids(ok), []);
  });
  test('catch body emptied', () => {
    const a = TS.replace('  return gateway.charge(amount);', '  try {\n    return gateway.charge(amount);\n  } catch (e) {\n    throw new PaymentError(e);\n  }');
    const b = a.replace('    throw new PaymentError(e);\n', '');
    assert.deepEqual(ids(scanEdit('src/pay.ts', a, b)), ['error-swallowed']);
  });
  test('.catch(() => {})', () => {
    assert.deepEqual(ids(scanEdit('src/pay.ts', TS, TS.replace('gateway.charge(amount);', 'gateway.charge(amount).catch(() => {});'))), ['error-swallowed']);
  });
  test('python except: pass / except Exception: pass', () => {
    const py = 'def charge(amount):\n    return gateway.charge(amount)\n';
    const bare = scanEdit('app/pay.py', py, 'def charge(amount):\n    try:\n        return gateway.charge(amount)\n    except:\n        pass\n');
    assert.deepEqual(ids(bare), ['error-swallowed']);
    const exc = scanEdit('app/pay.py', py, 'def charge(amount):\n    try:\n        return gateway.charge(amount)\n    except Exception as e:  \n        pass\n');
    assert.deepEqual(ids(exc), ['error-swallowed']);
    const specific = scanEdit('app/pay.py', py, 'def charge(amount):\n    try:\n        return gateway.charge(amount)\n    except KeyError:\n        pass\n');
    assert.deepEqual(ids(specific), []);
    const handled = scanEdit('app/pay.py', py, 'def charge(amount):\n    try:\n        return gateway.charge(amount)\n    except Exception:\n        pass\n        raise\n');
    assert.deepEqual(ids(handled), []);
  });
  test('go if err != nil {} and rust Err(_) => {}', () => {
    const go = 'package pay\n\nfunc Charge() {\n\tdo()\n}\n';
    assert.deepEqual(ids(scanEdit('pay/pay.go', go, go.replace('\tdo()', '\tif err := do(); err != nil {\n\t}'))), ['error-swallowed']);
    const rs = 'pub fn f() {\n    run();\n}\n';
    assert.deepEqual(ids(scanEdit('src/f.rs', rs, rs.replace('    run();', '    match run() {\n        Ok(v) => use_it(v),\n        Err(_) => {}\n    }'))), ['error-swallowed']);
  });
});

test('test-env names inside string literals or regex literals are not flagged', () => {
  const before = 'export const a = 1;\n';
  const after = before + "export const label = '__TEST__ global';\nexport const re = /process\\.env\\.NODE_ENV === 'test'/;\n";
  assert.deepEqual(scanEdit('src/a.ts', before, after).filter((f) => f.ruleId === 'test-env-special-case'), []);
});
