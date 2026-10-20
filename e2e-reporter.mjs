import path from 'node:path';
import generator from './scripts/generate-report.js';

/** Register once in e2e.config.ts: reporters: ['list', e2rReporter()]. */
export function e2rReporter({ output = 'e2r-report/report.html', config } = {}) {
  return {
    name: 'e2r HTML report',
    async onRunFinished(run, signal) {
      try {
        const result = await generator.generateReport({ framework: 'e2e', projectRoot: run.projectRoot,
          config, output, report: run.report, resultsDir: run.artifactsRoot, signal });
        return [{ label: 'HTML report', text: path.relative(run.projectRoot, result.output) }];
      } catch (error) {
        console.error(`e2r 报告未更新：${error.message}`);
      }
    },
  };
}
