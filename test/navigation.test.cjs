const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fs, path, temp, browser, pathToFileURL } = require('./helpers.cjs');
const { entry } = require('../scripts/model.js');
const { generateReport } = require('../scripts/generate-report.js');

test('feature navigation filters with search and status, groups environment variants, and works offline', { timeout: 30000 }, async t => {
  const root = await temp(t);
  await fs.mkdir(path.join(root, 'e2r'), { recursive: true });
  await fs.writeFile(path.join(root, 'e2r', 'categories.json'), JSON.stringify({ categories: [
    { name: '账号与认证', match: { files: ['tests/auth*.e2e.ts'] } },
  ] }));
  const scenario = ['authenticate author'];
  const tests = [
    entry({ framework: 'e2e', file: 'tests/auth.e2e.ts', titlePath: scenario, target: 'author', status: 'passed', attempts: [] }),
    entry({ framework: 'e2e', file: 'tests/auth.e2e.ts', titlePath: scenario, target: 'sketch', status: 'notRun', attempts: [] }),
    entry({ framework: 'e2e', file: 'tests/auth-copy.e2e.ts', titlePath: scenario, target: 'author', status: 'failed', attempts: [] }),
    entry({ framework: 'e2e', file: 'tests/page-delete.e2e.ts', titlePath: ['delete page'], status: 'notRun', attempts: [] }),
  ];
  const result = await generateReport({ projectRoot: root, framework: 'e2e', normalized: { tests, run: null } });
  assert.deepEqual(result.model.tests.map(row => row.category), ['账号与认证', '账号与认证', '账号与认证', 'page']);

  // The generated page carries its category labels and does not need the source config at read time.
  await fs.rm(path.join(root, 'e2r', 'categories.json'));
  const b = await browser(t);
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async () => { throw new Error('clipboard denied'); } },
  }));
  await page.goto(pathToFileURL(result.output).href);
  assert.equal(await page.locator('[data-category]').count(), 3);
  assert.match(await page.locator('[data-category="账号与认证"]').textContent(), /账号与认证\s+3/);
  assert.equal(await page.locator('.scenario-group').count(), 1);
  assert.match(await page.locator('.scenario-summary').textContent(), /2 个执行变体.*通过 1.*本次未执行 1/);
  await page.locator('.scenario-group [data-copy]').first().click();
  assert.match(await page.locator('#copy-text').inputValue(), /测试：authenticate author/);
  assert.match(await page.locator('#copy-text').inputValue(), /执行环境：author/);
  await page.locator('[data-close="copy-modal"]').click();

  await page.locator('[data-category="账号与认证"]').click();
  assert.equal(await page.locator('.test-item').count(), 3);
  assert.equal(await page.locator('#visible-count').textContent(), '显示 3 / 4 个测试项');
  await page.locator('#status-filter').selectOption('failed');
  assert.equal(await page.locator('.test-item').count(), 1);
  assert.equal(await page.locator('.test-title').textContent(), 'authenticate author');
  await page.locator('#search').fill('auth-copy');
  assert.equal(await page.locator('.test-item').count(), 1);
  await page.locator('.test-toggle').click();
  assert.match(await page.locator('.source-details').textContent(), /tests\/auth-copy.e2e.ts/);
  assert.deepEqual(errors, []);

  await fs.writeFile(path.join(root, 'e2r', 'categories.json'), '{broken');
  const fallback = await generateReport({ projectRoot: root, framework: 'e2e', normalized: { tests, run: null } });
  assert.match(fallback.model.warnings.join(' '), /功能分类配置无效.*已使用自动分类/);
  assert.equal(fallback.model.tests[0].category, 'auth');
});
