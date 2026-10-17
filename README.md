# pwr

测试运行后自动生成自包含 HTML 报告。零依赖，无需服务器，直接打开 HTML 即可。

支持 **Playwright** 和 **e2e**（tester-army/e2e）两种框架。自动检测报告格式，无需额外配置。

## 接入

### Playwright

在消费项目中完成以下两步，之后每次 `npx playwright test` 自动生成报告。

#### 1. 放置文件

将 `generate-report.js` 和 `reporter.ts` 放到消费项目根目录的 `pwr/` 下：

```
项目根目录/
├── playwright.config.ts
├── pwr/
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
    ['json', { outputFile: 'playwright-report/report.json' }],  // 必须 — pwr 依赖此 JSON
    ['./pwr/reporter.ts'],                                 // 自动触发 HTML 生成
  ],
  use: {
    video: 'on',
    screenshot: 'on',
  },
});
```

**要点：**
- `json` reporter 必须在 `reporter.ts` 之前，否则 pwr 读不到数据
- `video` 和 `screenshot` 设为 `on` 才能在报告中嵌入媒体

#### 验证

```sh
npx playwright test
ls pwr-report/report.html   # 测试结束后应存在
```

### e2e（tester-army/e2e）

e2e 框架无需自定义 reporter，测试结束后手动运行一次即可：

```sh
# 默认：读取 <project>/.e2e/report.json，输出 pwr-report/report.html
node pwr/generate-report.js "" .e2e/report.json pwr-report/report.html
```

artifact 路径自动从 `.e2e/results/` 解析，截图会内嵌到报告中。

## 默认路径

| 输入 | Playwright 默认 | e2e 默认 |
|------|----------------|----------|
| 测试结果目录 | `test-results/` | —（从 report.json 自动解析） |
| JSON 报告 | `playwright-report/report.json` | `.e2e/report.json` |
| 输出 HTML | `pwr-report/report.html` | `pwr-report/report.html` |

自定义路径：

```sh
node pwr/generate-report.js <test-results-dir> <json-report> <output-html>
```

> Playwright 模式下第一个参数为 `test-results/` 目录；e2e 模式下可传 `""` 跳过。

## 其他集成方式

### package.json script

不需要自定义 reporter 时，可直接链式调用：

```json
{
  "scripts": {
    "test": "playwright test; node pwr/generate-report.js"
  }
}
```

## 注意事项

- 报告是单个 HTML 文件，截图和视频以 base64 内嵌，可直接分享
- 未产生 `test-results/` 目录时（全部通过且未配置截图/视频），报告中不含媒体
- `reporter.ts` 通过 `__dirname` 定位 `generate-report.js`，两者必须同目录
- e2e 报告中会显示 tags 和 setup 测试标记

## Demo

```sh
cd pwr
# Playwright demo
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
