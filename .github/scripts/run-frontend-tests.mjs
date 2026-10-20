import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Each upstream suite gets a fresh Bun process: mock.module replacements must
// not leak from one hook/component suite into unrelated suites.
function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? testFiles(path) : /\.test\.[cm]?[jt]sx?$/.test(path) ? [path] : [];
  });
}

const results = [];
for (const file of testFiles('tests').sort()) {
  const started = performance.now();
  const result = spawnSync('bun', ['test', file], { stdio: 'inherit' });
  const row = { file, status: result.status, elapsedSeconds: (performance.now() - started) / 1000 };
  results.push(row);
  if (result.error) console.error(result.error.message);
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
const failures = results.filter((result) => result.status !== 0);
console.log(`${results.length - failures.length}/${results.length} frontend suites passed`);
for (const failure of failures) console.error(`FAILED ${failure.file}`);
process.exitCode = failures.length ? 1 : 0;
