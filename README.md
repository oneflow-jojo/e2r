# e2r

e2e 测试运行后自动生成自包含 HTML 报告。零依赖，无需服务器，直接打开 HTML 即可。

支持 **tester-army/e2e** 和 **Playwright** 两种框架，自动检测报告格式。

## 接入

### e2e（tester-army/e2e）

测试结束后手动运行一次即可：

```sh
# 默认：读取 <project>/.e2e/report.json，输出 e2r-report/report.html
node e2r/generate-report.js "" .e2e/report.json e2r-report/report.html
```

artifact 路径自动从 `.e2e/results/` 解析，截图会内嵌到报告中。

### Playwright

#### 1. 放置文件

将 `generate-report.js` 和 `reporter.ts` 放到消费项目根目录的 `e2r/` 下：

```
项目根目录/
├── playwright.config.ts
├── e2r/
│   ├── generate-report.js
│   └── reporter.ts
├── tests/
└── ...
```

#### 2. 配置 playwright.config.ts

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['json', { outputFile: 'playwright-report/report.json' }],
    ['./e2r/reporter.ts'],
  ],
  use: {
    video: 'on',
    screenshot: 'on',
  },
});
```

**要点：**
- `json` reporter 必须在 `reporter.ts` 之前，否则 e2r 读不到数据
- `video` 和 `screenshot` 设为 `on` 才能在报告中嵌入媒体

#### 验证

```sh
npx playwright test
ls e2r-report/report.html
```

## 默认路径

| 输入 | e2e 默认 | Playwright 默认 |
|------|----------|----------------|
| 测试结果目录 | —（从 report.json 自动解析） | `test-results/` |
| JSON 报告 | `.e2e/report.json` | `playwright-report/report.json` |
| 输出 HTML | `e2r-report/report.html` | `e2r-report/report.html` |

自定义路径：

```sh
node e2r/generate-report.js <test-results-dir> <json-report> <output-html>
```

> e2e 模式下第一个参数传 `""` 跳过；Playwright 模式下为 `test-results/` 目录。

## 其他集成方式

### package.json script

```json
{
  "scripts": {
    "test:e2e": "e2e run; node e2r/generate-report.js '' .e2e/report.json e2r-report/report.html",
    "test:pw": "playwright test; node e2r/generate-report.js"
  }
}
```

## 注意事项

- 报告是单个 HTML 文件，截图和视频以 base64 内嵌，可直接分享
- 未产生 artifact 时报告中不含媒体
- `reporter.ts` 通过 `__dirname` 定位 `generate-report.js`，两者必须同目录
- e2e 报告中会显示 tags 和 setup 测试标记

## Demo

```sh
cd e2r
node generate-report.js demo/test-results demo/playwright-report/report.json demo-report.html
open demo-report.html
```

## Features

- Self-contained HTML (all assets base64-embedded)
- Screenshot gallery with lightbox
- Video playback (WebM/MP4)
- Filter by pass/fail/skipped/flaky
- Error messages display
- Tags & setup test indicators (e2e)
- No server, no dependencies, no network required
