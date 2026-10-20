const path = require('node:path');
const { createHash } = require('node:crypto');

const statusNames = {
  passed: '通过', failed: '失败', flaky: '重试后通过', skipped: '跳过',
  timedOut: '超时', interrupted: '中断', notRun: '本次未执行', unknown: '未知',
};
const posix = value => String(value || '').replaceAll('\\', '/');
const message = error => typeof error === 'string' ? error : error?.message || '';
const normalizeStatus = status => status === 'timed-out' ? 'timedOut' : status;
const relative = (root, file) => !file ? '' : posix(path.isAbsolute(file) ? path.relative(root, file) : file);

/** A row is an exact declaration + target/project + agent + repeat variant. */
function identity(test) {
  return JSON.stringify([test.framework, test.file, test.titlePath, test.kind || 'test',
    test.target || '', test.agent || '', test.repeat || 0]);
}
function entry(data) {
  const test = { kind: 'test', target: '', agent: '', repeat: 0, tags: [], attempts: [],
    selected: false, status: 'notRun', ...data };
  test.title = test.titlePath.at(-1) || '(未命名测试)';
  test.suite = [test.file, ...test.titlePath.slice(0, -1)].filter(Boolean).join(' › ');
  test.key = identity(test);
  test.id = createHash('sha256').update(test.key).digest('hex').slice(0, 24);
  return test;
}
function artifact(a, root, shared = false) {
  return { name: a.name || path.basename(a.path || '') || (a.kind === 'video' ? '录屏' : '截图'),
    type: a.kind || (a.contentType?.startsWith('video/') ? 'video' : 'screenshot'),
    mime: a.mediaType || a.contentType || '', shared,
    ...(a.path ? { source: path.resolve(root, a.path) } : {}),
    ...(a.body ? { body: a.body } : {}),
    ...(a.url ? { remote: a.url } : {}) };
}
function isMedia(a) {
  return ['screenshot', 'video'].includes(a.kind) || /^(image|video)\//.test(a.contentType || '');
}
function e2eAttempts(result, groups, root) {
  if (!result.serialGroupId) {
    return (result.attempts || []).map((a, i) => ({ index: (a.index ?? i) + 1, status: normalizeStatus(a.status),
      startedAt: a.startedAt, duration: a.durationMs || 0, error: message(a.error),
      media: (a.artifacts || []).filter(isMedia).map(x => artifact(x, root)) }));
  }
  const group = groups.find(g => g.id === result.serialGroupId);
  return (group?.attempts || []).flatMap((a, i) => {
    const member = (a.members || []).find(m => m.testId === result.testId);
    if (!member) return [];
    const steps = new Set();
    const refs = new Set([member.failure?.screenshot]);
    function walk(items) {
      for (const s of items || []) {
        steps.add(s.id);
        for (const id of s.artifacts || []) refs.add(id);
        walk(s.steps);
      }
    }
    walk(member.steps);
    const owned = new Set();
    for (const m of a.members || []) {
      if (m.failure?.screenshot) owned.add(m.failure.screenshot);
      for (const s of m.steps || []) for (const id of s.artifacts || []) owned.add(id);
    }
    const media = (a.artifacts || []).filter(isMedia).flatMap(x => {
      const own = refs.has(x.id) || (x.producer?.kind === 'step' && steps.has(x.producer.stepId));
      const shared = x.producer?.kind === 'attempt' && !owned.has(x.id);
      return own || shared ? [artifact(x, root, !own)] : [];
    });
    return [{ index: (a.index ?? i) + 1, status: normalizeStatus(member.status), startedAt: member.startedAt,
      duration: member.durationMs || 0, error: message(member.error || (member.status === 'failed' ? a.error : null)), media }];
  });
}
function normalizeE2E(report, root) {
  if (report?.schemaVersion !== 'report-1' || !Array.isArray(report.run?.results)) {
    throw new Error('不支持的 e2e 报告：需要 report-1 和 run.results。');
  }
  const run = report.run;
  const tests = run.results.map(r => entry({ framework: 'e2e', nativeId: r.id, testId: r.testId,
    file: posix(r.file || r.source?.file), source: r.source, titlePath: r.titlePath || [r.testId],
    kind: r.kind, tags: r.tags || [], target: r.targetId || '', agent: r.agent || '', repeat: r.repeat || 0,
    selected: r.selected !== false, status: r.selected === false ? 'notRun' : normalizeStatus(r.status || 'unknown'),
    reason: r.skip?.reason || '', attempts: r.selected === false ? [] : e2eAttempts(r, run.serialGroups || [], root),
  }));
  return { tests, run: { id: run.id, startedAt: run.startedAt, finishedAt: run.finishedAt,
    duration: run.finishedAt && run.startedAt ? Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)) : null,
    status: run.status, errors: (run.errors || []).map(message) } };
}
function catalogE2E(pairs) {
  return pairs.map(p => entry({ framework: 'e2e', nativeId: p.id, file: posix(p.file),
    titlePath: p.titlePath || [p.title], source: p.source, kind: p.kind, tags: p.tags,
    target: p.target, agent: p.agent, reason: p.disposition === 'skip' ? p.reason || '' : '',
    declaredSkip: p.disposition === 'skip' }));
}
function pwStatus(outcome, results, expectedStatus) {
  const last = results.at(-1);
  if (last?.status === 'interrupted') return 'interrupted';
  if (!results.length) return 'notRun';
  if (outcome === 'flaky') return 'flaky';
  if (outcome === 'skipped' || last?.status === 'skipped') return 'skipped';
  if (outcome === 'unexpected') return last?.status === 'timedOut' ? 'timedOut' : 'failed';
  if (outcome === 'expected') return 'passed';
  if (last?.status === 'passed' && expectedStatus === 'failed') return 'failed';
  if (last?.status === 'passed' && results.some(r => ['failed', 'timedOut'].includes(r.status))) return 'flaky';
  return normalizeStatus(last?.status || 'unknown');
}
function pwEntry(data, results, root, outcome, expectedStatus) {
  return entry({ ...data, expectedStatus, selected: results.length > 0,
    status: pwStatus(outcome, results, expectedStatus),
    attempts: results.map((r, i) => ({ index: (r.retry ?? i) + 1, status: normalizeStatus(r.status),
      duration: r.duration || 0, startedAt: r.startTime instanceof Date ? r.startTime.toISOString() : r.startTime,
      error: message(r.error || r.errors?.[0]), media: (r.attachments || []).filter(isMedia).map(a =>
        artifact({ ...a, body: Buffer.isBuffer(a.body) ? a.body.toString('base64') : a.body }, root)) })) });
}
function normalizePlaywrightJSON(report, projectRoot) {
  if (!Array.isArray(report?.suites)) throw new Error('无效的 Playwright 报告：需要 suites 数组。');
  const tests = [];
  const sourceRoot = path.resolve(projectRoot, report.config?.rootDir || '.');
  const repeats = new Map();
  function walk(suites, parents = [], depth = 0) {
    for (const s of suites) {
      const titles = depth === 0 && s.file ? [] : [...parents, s.title].filter(Boolean);
      for (const spec of s.specs || []) for (const t of spec.tests || []) {
        const file = relative(projectRoot, path.resolve(sourceRoot, spec.file || s.file || ''));
        const target = t.projectName || t.projectId || '';
        const repeatKey = JSON.stringify([file, titles, spec.title, target]);
        const repeat = t.repeatEachIndex ?? repeats.get(repeatKey) ?? 0;
        repeats.set(repeatKey, repeat + 1);
        tests.push(pwEntry({ framework: 'playwright', nativeId: spec.id, file,
          source: spec.line ? { file, line: spec.line, column: spec.column } : undefined,
          titlePath: [...titles, spec.title], target,
          repeat, tags: spec.tags || [],
          declaredSkip: t.expectedStatus === 'skipped',
        }, t.results || [], projectRoot, t.status, t.expectedStatus));
      }
      walk(s.suites || [], titles, depth + 1);
    }
  }
  walk(report.suites);
  return { tests, run: { startedAt: report.stats?.startTime, duration: report.stats?.duration ?? null,
    status: report.stats?.unexpected || report.errors?.length || tests.some(t => ['failed', 'timedOut'].includes(t.status))
      ? 'failed' : tests.some(t => t.status === 'interrupted') ? 'interrupted' : tests.some(t => t.selected) ? 'passed' : 'unknown',
    errors: (report.errors || []).map(message) } };
}
function normalizePlaywrightSuite(config, suite, result, projectRoot) {
  const tests = suite.allTests().map(t => {
    const parents = [];
    for (let s = t.parent; s; s = s.parent) if (s.type === 'describe') parents.unshift(s.title);
    const file = relative(projectRoot, t.location.file);
    return pwEntry({ framework: 'playwright', nativeId: t.id, file,
      source: { ...t.location, file }, titlePath: [...parents, t.title],
      target: t.parent.project()?.name || '', repeat: t.repeatEachIndex || 0,
      tags: t.tags || [], declaredSkip: t.expectedStatus === 'skipped',
    }, t.results, projectRoot, t.outcome(), t.expectedStatus);
  });
  return { tests, run: { status: result.status, startedAt: result.startTime?.toISOString(),
    duration: result.duration ?? null, errors: [] } };
}
function mergeCatalog(catalog, results) {
  const map = new Map(catalog.map(t => [t.key, t]));
  for (const t of results) map.set(t.key, t);
  return [...map.values()];
}
module.exports = { entry, identity, statusNames, normalizeE2E, catalogE2E,
  normalizePlaywrightJSON, normalizePlaywrightSuite, mergeCatalog };
