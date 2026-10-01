// Make the CLI entry executable after tsc (no-op on Windows).
const fs = require('fs');
try { fs.chmodSync('dist/cli.js', 0o755); } catch { /* not fatal */ }
