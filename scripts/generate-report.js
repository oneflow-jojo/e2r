#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const { discover } = require('./discover.js');
const { normalizeE2E, normalizePlaywrightJSON, mergeCatalog } = require('./model.js');
const { prepareMedia, publish } = require('./media.js');
const { renderReport } = require('./render-report.js');

async function generateReport(options) {
  const projectRoot = await fs.realpath(path.resolve(options.projectRoot || process.cwd()));
  const output = path.resolve(projectRoot, options.output || 'e2r-report/report.html');
  const config = options.config ? path.resolve(projectRoot, options.config) : undefined;
  const framework = options.framework;
  if (!['e2e', 'playwright'].includes(framework)) throw new Error('请指定 --framework e2e 或 playwright。');
  const warnings = [];
  let normalized = { tests: [], run: null };
  if (!options.catalogOnly) {
    if (options.normalized) normalized = options.normalized;
    else if (options.report) normalized = framework === 'e2e'
      ? normalizeE2E(options.report, path.resolve(projectRoot, options.resultsDir || '.e2e/results'))
      : normalizePlaywrightJSON(options.report, projectRoot);
    else throw new Error('未提供本次运行报告。未执行测试时请使用 --catalog-only。');
  }
  let catalog = [];
  let catalogComplete = false;
  try {
    catalog = await discover({ framework, projectRoot, config, signal: options.signal });
    catalogComplete = true;
  } catch (error) {
    if (options.signal?.aborted || options.catalogOnly) throw error;
    warnings.push(`目录未完整刷新，仅展示本次导入的执行结果。原因：${error.message}`);
  }
  const tests = mergeCatalog(catalog, normalized.tests);
  const model = { framework, tests, run: normalized.run, generatedAt: new Date().toISOString(),
    catalogOnly: !!options.catalogOnly, catalogComplete, warnings };
  await fs.mkdir(path.dirname(output), { recursive: true });
  const staging = await fs.mkdtemp(path.join(path.dirname(output), '.e2r-tmp-'));
  try {
    const media = await prepareMedia(tests, { projectRoot, output, staging, signal: options.signal });
    model.tests = media.tests;
    if (media.missing) warnings.push(`${media.missing} 个媒体文件不可用，请查看对应测试。`);
    const html = renderReport(model);
    await publish({ output, staging, media, html, signal: options.signal });
    return { output, model };
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}
function parseArgs(args) {
  const options = {}, positional = [];
  const names = { '--framework': 'framework', '--project-root': 'projectRoot', '--config': 'config', '--output': 'output' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--catalog-only') options.catalogOnly = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (names[arg]) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${arg} 缺少参数。`);
      options[names[arg]] = args[++i];
    } else if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 3) throw new Error('最多接受三个位置参数：结果目录、JSON 报告、输出 HTML。');
  if (positional[0]) options.resultsDir = positional[0];
  if (positional[1]) options.reportFile = positional[1];
  if (positional[2] && !options.output) options.output = positional[2];
  return options;
}
async function locateProject(options) {
  if (options.projectRoot) return path.resolve(options.projectRoot);
  if (options.config) return path.dirname(path.resolve(options.config));
  let dir = process.cwd();
  while (true) {
    const names = (await fs.readdir(dir)).filter(n => /^(e2e|playwright)\.config\.[cm]?[jt]s$/.test(n));
    const matching = names.filter(n => !options.framework || n.startsWith(options.framework + '.'));
    if (matching.length) {
      if (options.reportFile && !options.framework) return dir;
      if (!options.framework && new Set(matching.map(n => n.split('.')[0])).size > 1) throw new Error('项目同时包含两种框架，请指定 --framework。');
      if (matching.length > 1) throw new Error('存在多个框架配置，请使用 --config 指定。');
      if (!options.framework) options.framework = matching[0].split('.')[0];
      options.config = path.join(dir, matching[0]); return dir;
    }
    const parent = path.dirname(dir); if (parent === dir) return process.cwd(); dir = parent;
  }
}
async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('用法：node e2r/scripts/generate-report.js [结果目录] [JSON报告] [输出HTML]\n      --framework e2e|playwright --catalog-only [--project-root 目录] [--config 文件] [--output HTML]'); return;
  }
  options.projectRoot = await locateProject(options);
  if (!options.catalogOnly) {
    const candidate = options.reportFile || (options.framework === 'e2e' ? '.e2e/report.json' : 'playwright-report/report.json');
    const reportPath = path.resolve(options.projectRoot, candidate);
    options.report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    const detected = options.report.schemaVersion ? 'e2e' : Array.isArray(options.report.suites) ? 'playwright' : null;
    if (options.framework && detected !== options.framework) throw new Error('报告格式与 --framework 不一致。');
    options.framework ||= detected;
    options.reportFile = reportPath;
  }
  if (options.framework === 'e2e' && !options.resultsDir && !options.catalogOnly) {
    options.resultsDir = path.join(path.dirname(options.reportFile), 'results');
  }
  const result = await generateReport(options);
  console.log(`e2r 报告已生成：${result.output}\n${result.model.tests.length} 个测试项。分享时请携带同目录的 ${path.basename(result.output, path.extname(result.output))}.media/。`);
  return result;
}
if (require.main === module) main().catch(error => { console.error(`e2r 报告未更新：${error.message}`); process.exitCode = 1; });
module.exports = { generateReport, main, parseArgs, locateProject };
