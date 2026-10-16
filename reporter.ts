import type { Reporter, FullResult } from '@playwright/test/reporter';
import { execSync } from 'child_process';
import path from 'path';

class ReportGenerator implements Reporter {
  async onEnd(result: FullResult) {
    const scriptPath = path.join(__dirname, 'generate-report.js');
    try {
      execSync(`node "${scriptPath}"`, { stdio: 'inherit' });
    } catch {
      console.error('Failed to generate HTML report');
    }
  }
}

export default ReportGenerator;
