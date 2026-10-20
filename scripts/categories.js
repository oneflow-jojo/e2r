const fs = require('node:fs/promises');
const path = require('node:path');

const genericSegments = new Set(['', 'test', 'tests', 'spec', 'specs', 'e2e', 'e2es', '__tests__', 'playwright', 'src',
  'demo', 'example', 'examples', 'sample', 'samples', 'fixture', 'fixtures']);
const posix = value => String(value || '').replaceAll('\\', '/');
const isGenericSegment = value => genericSegments.has(value.toLowerCase()) || /^(?:e2e|test|spec)[-_ ].+$/i.test(value);

function globRegExp(pattern) {
  const input = posix(pattern);
  let source = '^';
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '*') {
      if (input[i + 1] === '*') {
        i++;
        if (input[i + 1] === '/') { i++; source += '(?:.*/)?'; }
        else source += '.*';
      } else source += '[^/]*';
    } else if (char === '?') source += '[^/]';
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(source + '$');
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || !Array.isArray(config.categories)) {
    throw new Error('需要包含 categories 数组。');
  }
  return config.categories.map((category, index) => {
    if (!category || typeof category !== 'object' || Array.isArray(category)
      || typeof category.name !== 'string' || !category.name.trim()
      || !category.match || typeof category.match !== 'object' || Array.isArray(category.match)) {
      throw new Error(`第 ${index + 1} 个分类需要 name 和 match。`);
    }
    const match = {};
    for (const key of ['files', 'suites', 'tags']) {
      if (category.match[key] == null) continue;
      if (!Array.isArray(category.match[key]) || !category.match[key].length
        || category.match[key].some(value => typeof value !== 'string' || !value.trim())) {
        throw new Error(`第 ${index + 1} 个分类的 match.${key} 必须是非空字符串数组。`);
      }
      match[key] = category.match[key];
    }
    if (!Object.keys(match).length) throw new Error(`第 ${index + 1} 个分类至少需要一个 files、suites 或 tags 规则。`);
    return { name: category.name.trim(), match,
      filePatterns: (match.files || []).map(globRegExp) };
  });
}

async function readCategoryConfig(projectRoot) {
  const file = path.join(projectRoot, 'e2r', 'categories.json');
  let source;
  try { source = await fs.readFile(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return { rules: [], warning: '' };
    return { rules: [], warning: `无法读取功能分类配置 ${path.relative(projectRoot, file)}，已使用自动分类：${error.message}` };
  }
  try { return { rules: validateConfig(JSON.parse(source)), warning: '' }; }
  catch (error) {
    return { rules: [], warning: `功能分类配置无效（${error.message}），已使用自动分类。` };
  }
}

function configuredCategory(test, rules) {
  const file = posix(test.file);
  const suites = (test.titlePath || []).slice(0, -1);
  const tags = test.tags || [];
  for (const rule of rules) {
    const { match } = rule;
    const matched = (match.files || []).some((_, index) => rule.filePatterns[index].test(file))
      || (match.suites || []).some(suite => suites.includes(suite))
      || (match.tags || []).some(tag => tags.includes(tag));
    if (matched) return rule.name;
  }
  return '';
}

function cleanName(value) {
  return String(value || '').replaceAll('\\', '/').replace(/[-_.]+/g, ' ').trim();
}

function stemTokens(file) {
  let stem = path.posix.basename(posix(file));
  stem = stem.replace(/(?:\.(?:e2e|spec|test))?\.[^.]+$/i, '');
  return stem.split(/[-_.\s]+/).filter(token => token && !genericSegments.has(token.toLowerCase()));
}

function sharedFilePrefix(file, tests) {
  const tokens = stemTokens(file);
  if (!tokens.length) return '';
  const otherFiles = [...new Set(tests.map(test => posix(test.file)).filter(other => other && other !== posix(file)))];
  let best = [];
  for (let end = 1; end <= tokens.length; end++) {
    const prefix = tokens.slice(0, end);
    const count = otherFiles.filter(other => {
      const candidate = stemTokens(other);
      return candidate.length >= end && prefix.every((token, index) => token.toLowerCase() === candidate[index].toLowerCase());
    }).length;
    if (count) best = prefix;
  }
  return (best.length ? best : tokens.slice(0, 1)).join(' ');
}

function inferredCategory(test, tests) {
  const suites = (test.titlePath || []).slice(0, -1).map(cleanName).filter(name => name && !isGenericSegment(name));
  if (suites.length) return suites[0];
  const segments = posix(test.file).split('/');
  const folders = segments.slice(0, -1).filter(segment => !isGenericSegment(segment));
  if (folders.length) return cleanName(folders.at(-1));
  const prefix = sharedFilePrefix(test.file, tests);
  return cleanName(prefix) || '其他';
}

function categorizeTests(tests, rules = []) {
  const scenarios = new Map();
  for (const test of tests) {
    const key = JSON.stringify([test.framework, test.file, test.titlePath, test.kind || 'test']);
    if (!scenarios.has(key)) scenarios.set(key, []);
    scenarios.get(key).push(test);
  }
  const categories = new Map();
  for (const [key, variants] of scenarios) {
    const configured = rules.find(rule => variants.some(test => configuredCategory(test, [rule])));
    categories.set(key, configured?.name || inferredCategory(variants[0], tests) || '其他');
  }
  return tests.map(test => {
    const key = JSON.stringify([test.framework, test.file, test.titlePath, test.kind || 'test']);
    return { ...test, category: categories.get(key) || '其他' };
  });
}

module.exports = { categorizeTests, inferredCategory, readCategoryConfig, validateConfig, globRegExp };
