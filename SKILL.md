---
name: e2r
description: Generate and open portable HTML test catalogs and execution evidence from tester-army/e2e or Playwright. Use when viewing existing tests, screenshots, recordings, or generating an e2r report.
---

# e2r

Keep the tool in the consuming project's version-controlled `e2r/` directory. Copy the entire `scripts/` directory, including its package.json, CSS and browser script, plus the matching framework reporter. Configure the reporter once; preserve existing project settings. Follow [README.md](README.md) for setup and custom paths when that file is available.

Generated output belongs in the sibling `e2r-report/` directory. The project root's `.gitignore` should include `/e2r-report/` and `.e2r-tmp-*/`, while `e2r/`, test configuration, dependencies and lockfile stay tracked. Copy source files rather than linking to another machine's paths or copying a nested `.git/` directory.

## Workflow

- After editing tests without executing them, refresh the catalog with the appropriate command from the project root:

  ```sh
  node e2r/scripts/generate-report.js --framework e2e --catalog-only
  node e2r/scripts/generate-report.js --framework playwright --catalog-only
  ```

- After a test run with the reporter configured, use its generated report; do not create a second copy. Open or link `e2r-report/report.html` for the user.
- Without automatic integration, import the current run's JSON:

  ```sh
  node e2r/scripts/generate-report.js "" .e2e/report.json e2r-report/report.html
  node e2r/scripts/generate-report.js test-results playwright-report/report.json e2r-report/report.html
  ```

Use `--project-root`, `--config` and `--output` for nonstandard locations. Resolve the tool from this project's checkout, not a global skill installation. With a nonstandard e2e config name, pass its path to `e2rReporter({ config: '...' })` too.

For automatic integration, add `e2rReporter()` from `./e2r/e2e-reporter.mjs` to e2e's `reporters`, or `['./e2r/reporter.cjs']` to Playwright's. Playwright needs no extra JSON reporter. For visual inspection of successful as well as failed runs, configure recording `video: 'on'`; use Playwright's `screenshot: 'on'` or e2e's actual screenshot capture facilities. The report cannot create evidence that the test runner did not capture.

The catalog is a snapshot. Catalog-only output intentionally contains no old run results; a partial run does not inherit old outcomes or media. Treat unavailable media or incomplete discovery as limitations, not evidence of a successful test.

The report is HTML plus a same-named `.media/` directory. Share or move both together. Local media is copied into the export; remote recordings remain network links. The user's “复制给 AI” text identifies the exact test, environment and attempt being discussed.
