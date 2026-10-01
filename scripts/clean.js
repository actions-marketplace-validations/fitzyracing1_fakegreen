// Cross-platform rm -rf for build output directories.
const fs = require('fs');
for (const dir of process.argv.slice(2)) fs.rmSync(dir, { recursive: true, force: true });
