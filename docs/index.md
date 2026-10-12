# fakegreen

fakegreen scans a git diff and flags changes that make a build look passing without fixing anything: skipped or deleted tests, weakened assertions, silenced linters, and neutered CI steps. It is deterministic, has zero runtime dependencies, and needs no LLM or API key (from `package.json` and `src/`).

- Language: TypeScript, compiled to `dist/` (CLI entry `dist/cli.js`)
- Requires: Node.js 18+ (`engines.node`) and `git` on `PATH`
- Distributed as: npm package `fakegreen`, a composite GitHub Action (`action.yml`), a pre-commit hook (`.pre-commit-hooks.yaml`), and an agent skill (`skills/fakegreen/SKILL.md`)

## Pages

- [Getting started](getting-started.md)
- [Usage](usage.md)
- [Architecture](architecture.md)
- Contributing: see [CONTRIBUTING.md](../CONTRIBUTING.md)

## CI

CI (`.github/workflows/ci.yml`) runs the tests on Node 18, 20 and 22 on Ubuntu, plus Node 22 on macOS. A run is **lit** when it succeeds and **dark** otherwise.

## License

MIT. Copyright (c) 2026 Joshua Almeida
