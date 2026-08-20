const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['node_modules', '.git']);
const files = [];

function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ignored.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && full.endsWith('.js')) files.push(full);
    }
}

walk(root);
let failed = false;
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        failed = true;
        console.error(`Syntax check failed: ${path.relative(root, file)}`);
        if (result.stderr) console.error(result.stderr.trim());
    }
}

const required = ['app.js', 'models/user.js', 'models/SignupOtp.js', 'routes/User.js', 'middlewares/rateLimiting.js'];
for (const file of required) {
    if (!fs.existsSync(path.join(root, file))) {
        failed = true;
        console.error(`Missing required file: ${file}`);
    }
}

if (failed) process.exit(1);
console.log(`Smoke test passed: ${files.length} JavaScript files checked.`);
