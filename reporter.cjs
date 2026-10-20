const path = require('node:path');
const { generateReport } = require('./scripts/generate-report.js');
const { normalizePlaywrightSuite } = require('./scripts/model.js');

class ReportGenerator {
  constructor({ output = 'e2r-report/report.html' } = {}) { this.output = output; this.errors = []; }
  onBegin(config, suite) { this.config = config; this.suite = suite; }
  onError(error) { this.errors.push(error.message || String(error)); }
  async onEnd(result) {
    try {
      if (!this.config || !this.suite) throw new Error('测试收集未完成，无法读取本次运行。');
      const projectRoot = this.config.configFile ? path.dirname(this.config.configFile) : this.config.rootDir;
      const normalized = normalizePlaywrightSuite(this.config, this.suite, result, projectRoot);
      normalized.run.errors.push(...this.errors);
      const report = await generateReport({ framework: 'playwright', projectRoot, config: this.config.configFile,
        output: this.output, normalized });
      console.log(`\ne2r 报告：${report.output}`);
    } catch (error) { console.error(`e2r 报告未更新：${error.message}`); }
  }
  printsToStdio() { return false; }
}
module.exports = ReportGenerator;
