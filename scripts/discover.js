const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { catalogE2E, normalizePlaywrightJSON } = require('./model.js');

function execNode(args, { cwd, env = process.env, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-12000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(output.trim() || `子进程退出：${code}`)));
  });
}
async function discover({ framework, projectRoot, config, signal }) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'e2r-discover-'));
  try {
    const output = path.join(temp, 'catalog.json');
    const timeout = AbortSignal.timeout(45000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    if (framework === 'e2e') {
      await execNode([__filename, projectRoot, config || '', output], { cwd: projectRoot, signal: combined });
      return catalogE2E(JSON.parse(await fs.readFile(output, 'utf8')).pairs);
    }
    const local = createRequire(path.join(projectRoot, 'package.json'));
    if (!config) {
      const candidates = (await fs.readdir(projectRoot)).filter(n => /^playwright\.config\.[cm]?[jt]s$/.test(n));
      if (candidates.length !== 1) throw new Error('无法确定 Playwright 配置，请使用 --config 指定。');
      config = path.join(projectRoot, candidates[0]);
    }
    let cli;
    try { cli = path.join(path.dirname(local.resolve('@playwright/test/package.json')), 'cli.js'); }
    catch { cli = path.join(path.dirname(local.resolve('playwright/package.json')), 'cli.js'); }
    await execNode([cli, 'test', '--list', '--reporter=json', '--pass-with-no-tests', '--repeat-each=1',
      '--grep=.*', '--grep-invert=(?!)', ...(config ? ['--config', config] : [])], {
      cwd: projectRoot, signal: combined,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: output },
    });
    return normalizePlaywrightJSON(JSON.parse(await fs.readFile(output, 'utf8')), projectRoot).tests;
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
if (require.main === module) {
  (async () => {
    const [root, config, output] = process.argv.slice(2);
    const local = createRequire(path.join(root, 'package.json'));
    const runner = await import(pathToFileURL(local.resolve('e2e/runner')).href);
    const result = await runner.list({ cwd: root, ...(config ? { config } : {}), passWithNoTests: true });
    await fs.writeFile(output, JSON.stringify(result));
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { discover, execNode };
