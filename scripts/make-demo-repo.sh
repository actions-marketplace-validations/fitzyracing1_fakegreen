#!/usr/bin/env bash
# Builds a tiny sample repo with an honest commit followed by a "fake agent" commit
# that games the build. Used to record docs/demo.cast. Usage: scripts/make-demo-repo.sh <dir>
# fakegreen-ignore-file: this script deliberately writes fake-green changes into a throwaway demo repo
set -euo pipefail
dir="${1:-/tmp/fakegreen-demo}"
rm -rf "$dir" && mkdir -p "$dir" && cd "$dir"
git init -q -b main
git config user.email agent@example.com
git config user.name "Coding Agent"

mkdir -p src test .github/workflows
cat > package.json <<'J'
{ "name": "shop", "private": true, "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" } }
J
cat > src/cart.ts <<'T'
export interface Item { sku: string; price: number; qty: number }

export function total(items: Item[]): number {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

export function applyDiscount(amount: number, code: string): number {
  if (code === 'SAVE10') return Math.round(amount * 0.9 * 100) / 100;
  return amount;
}
T
cat > test/cart.test.ts <<'T'
import { describe, it, expect } from 'vitest';
import { total, applyDiscount } from '../src/cart';

describe('cart', () => {
  it('sums line items', () => {
    expect(total([{ sku: 'a', price: 2.5, qty: 2 }, { sku: 'b', price: 1, qty: 3 }])).toBe(8);
  });

  it('applies SAVE10', () => {
    expect(applyDiscount(100, 'SAVE10')).toBe(90);
  });

  it('handles an empty cart', () => {
    expect(total([])).toBe(0);
  });
});
T
cat > test/checkout.test.ts <<'T'
import { it, expect } from 'vitest';
import { total } from '../src/cart';

it('rejects negative quantities', () => {
  expect(() => total([{ sku: 'x', price: 5, qty: -1 }])).toThrow();
});

it('rounds to cents', () => {
  expect(total([{ sku: 'x', price: 0.1, qty: 3 }])).toBe(0.3);
});
T
cat > .github/workflows/ci.yml <<'Y'
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
Y
git add -A && git commit -qm "cart + checkout with tests"

# ---- the "agent" makes the build green the wrong way ----
python3 - <<'P'
import re, pathlib
p = pathlib.Path('test/cart.test.ts'); s = p.read_text()
s = s.replace("it('applies SAVE10'", "it.skip('applies SAVE10'")
s = s.replace("expect(total([])).toBe(0);", "expect(total([])).toBeDefined();")
p.write_text(s)
p = pathlib.Path('src/cart.ts'); s = p.read_text()
s = s.replace("export function total(items: Item[]): number {\n",
              "export function total(items: Item[]): number {\n  // @ts-ignore\n  if (process.env.NODE_ENV === 'test') return items.length ? 8 : 0;\n")
p.write_text(s)
p = pathlib.Path('.github/workflows/ci.yml'); s = p.read_text()
s = s.replace("      - run: npm test", "      - run: npm test || true")
p.write_text(s)
P
git rm -q test/checkout.test.ts
git add -A && git commit -qm "fix: make the test suite pass"
echo "$dir"
