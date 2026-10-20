const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeE2E, normalizePlaywrightJSON } = require('../scripts/model.js');
const { categorizeTests, readCategoryConfig, validateConfig } = require('../scripts/categories.js');

test('automatic categories use suites, meaningful directories, shared file prefixes, then Other', () => {
  const e2e = normalizeE2E({ schemaVersion: 'report-1', run: { results: [
    { id: 'a', file: 'test/e2e-army/tests/auth.setup.e2e.ts', titlePath: ['authenticate'], tags: [] },
    { id: 'b', file: 'test/e2e-army/tests/auth.login.e2e.ts', titlePath: ['login'], tags: [] },
    { id: 'c', file: 'test/e2e-army/tests/page-edit-save.e2e.ts', titlePath: ['save'], tags: [] },
    { id: 'd', file: 'test/e2e-army/tests/page-edit-denied.e2e.ts', titlePath: ['denied'], tags: [] },
    { id: 'e', file: '', titlePath: ['unknown'], tags: [] },
    { id: 'f', file: 'demo/tests/example.e2e.ts', titlePath: ['example'], tags: [] },
  ] } }, '/tmp');
  const categorized = categorizeTests(e2e.tests);
  assert.deepEqual(categorized.map(t => t.category), ['auth', 'auth', 'page edit', 'page edit', '其他', '其他']);

  const playwright = normalizePlaywrightJSON({ suites: [{ title: 'account.spec.ts', file: 'tests/account.spec.ts', suites: [
    { title: 'Account settings', file: 'tests/account.spec.ts', specs: [{ title: 'change email', file: 'tests/account.spec.ts', tests: [
      { projectName: 'chromium', expectedStatus: 'passed', status: 'expected', results: [] },
    ] }] },
  ] }] }, '/tmp');
  assert.equal(categorizeTests(playwright.tests)[0].category, 'Account settings');
});

test('configured file, suite and tag rules override inference in declaration order', () => {
  const tests = normalizeE2E({ schemaVersion: 'report-1', run: { results: [
    { id: 'a', file: 'tests/auth.login.e2e.ts', titlePath: ['login'], tags: ['account'] },
    { id: 'b', file: 'tests/other.e2e.ts', titlePath: ['Account settings', 'edit'], tags: ['account'] },
  ] } }, '/tmp').tests;
  const rules = validateConfig({ categories: [
    { name: '账号与认证', match: { files: ['**/auth*.e2e.ts'] } },
    { name: '账户设置', match: { suites: ['Account settings'] } },
    { name: '账号标签', match: { tags: ['account'] } },
  ] });
  assert.deepEqual(categorizeTests(tests, rules).map(t => t.category), ['账号与认证', '账户设置']);
  const variants = normalizeE2E({ schemaVersion: 'report-1', run: { results: [
    { id: 'author', file: 'tests/auth.login.e2e.ts', titlePath: ['login'], tags: ['account'], targetId: 'author' },
    { id: 'sketch', file: 'tests/auth.login.e2e.ts', titlePath: ['login'], tags: ['guest'], targetId: 'sketch' },
  ] } }, '/tmp').tests;
  const variantRules = validateConfig({ categories: [
    { name: '访客', match: { tags: ['guest'] } },
    { name: '账号', match: { tags: ['account'] } },
  ] });
  assert.deepEqual(categorizeTests(variants, variantRules).map(t => t.category), ['访客', '访客']);
  assert.throws(() => validateConfig({ categories: [{ name: '缺少规则', match: {} }] }), /至少需要/);
  assert.throws(() => validateConfig({ categories: [{ name: '空规则', match: { files: [] } }] }), /必须是非空字符串数组/);
});

test('missing category config is silent and malformed config returns a warning', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e2r-category-config-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.deepEqual(await readCategoryConfig(root), { rules: [], warning: '' });
  await fs.mkdir(path.join(root, 'e2r'));
  await fs.writeFile(path.join(root, 'e2r', 'categories.json'), '{broken');
  const result = await readCategoryConfig(root);
  assert.deepEqual(result.rules, []);
  assert.match(result.warning, /已使用自动分类/);
});
