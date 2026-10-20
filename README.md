# e2r

把测试清单、本次运行结果、截图和录屏放在一个可直接打开的页面里。支持 tester-army/e2e 与 Playwright。生成器无需额外运行依赖，测试发现使用项目已经安装的测试框架；浏览报告无需服务器。

## 把工具随项目保存

将本仓库的 `scripts/`、`e2e-reporter.mjs`、`reporter.cjs` 复制到消费项目的 `e2r/` 中。**复制整个 `scripts/`，包括其中的 `package.json`、CSS 和浏览器脚本。** 可以同时保留 `SKILL.md`，供 AI 了解使用流程。不要复制本仓库的 `.git/`、`node_modules/`、`dev/` 或生成报告。

```text
项目根目录/
├── e2r/                        # 提交到项目 Git
│   ├── e2e-reporter.mjs
│   ├── reporter.cjs
│   ├── SKILL.md                # 可选，供 AI 使用
│   └── scripts/                # 全部生成代码、样式、脚本和 package.json
├── e2e.config.ts               # 或 playwright.config.ts，提交到 Git
├── package.json                # 包含项目测试依赖和命令，提交到 Git
├── package-lock.json           # 或项目使用的其他依赖锁文件，提交到 Git
├── .gitignore                  # 提交到 Git
└── e2r-report/                 # 生成物，不提交
    ├── report.html
    └── report.media/
```

在**消费项目根目录**的 `.gitignore` 中添加：

```gitignore
/e2r-report/
.e2r-tmp-*/
```

不要忽略 `e2r/`。如果报告目录已经被 Git 跟踪，先运行 `git rm -r --cached -- e2r-report`，保留磁盘上的文件，然后提交忽略规则。截图、录屏等测试框架原始运行目录也应按项目惯例忽略。

提交工具、测试配置、依赖清单和锁文件。换电脑后克隆项目，按锁文件安装依赖（npm 项目使用 `npm ci`），再运行测试或刷新目录。无需全局安装 e2r，也不依赖原电脑的路径。框架自身需要的浏览器、系统依赖和环境变量仍按该项目的测试环境说明准备。历史报告不会随 Git 迁移，可以重新生成。

## tester-army/e2e 接入

在现有 `e2e.config.ts` 中保留项目配置，添加：

```ts
import { e2rReporter } from './e2r/e2e-reporter.mjs';

export default {
  // ...项目已有的 targets、tests 等配置
  video: 'on',
  reporters: ['list', e2rReporter()],
};
```

之后每次正常运行 `e2e run` 都会自动生成 `<项目根目录>/e2r-report/report.html`。`video: 'on'` 用于记录通过与失败的执行过程；目标或单条测试的设置可能覆盖它。截图由框架的失败捕获、断言或测试中的 `app.screenshot('说明')` 产生，reporter 不会补拍未捕获的截图。

自定义输出和非标准名称的配置：

```ts
e2rReporter({ output: 'e2r-report/report.html', config: 'e2e.custom.config.ts' })
```

## Playwright 接入

在已有 `playwright.config.ts` 中添加 reporter，并开启需要的证据：

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // ...项目已有配置
  reporter: [['list'], ['./e2r/reporter.cjs']],
  use: { video: 'on', screenshot: 'on' },
});
```

不需要额外 JSON reporter，也没有 reporter 注册顺序要求；项目已有的其他 reporter 可保留。自定义输出使用 `['./e2r/reporter.cjs', { output: 'e2r-report/report.html' }]`。

## 未执行也能查看完整目录

在消费项目中运行相应命令：

```sh
node e2r/scripts/generate-report.js --framework e2e --catalog-only
node e2r/scripts/generate-report.js --framework playwright --catalog-only
```

发现过程不执行测试正文、不启动被测应用。目录覆盖配置声明的测试文件与环境，不继承某次运行的名称或文件筛选。目录是生成时的快照：新增、改名、删除测试后重新生成，然后重新打开或刷新页面。

纯目录模式不加载之前的运行结果，所有测试显示“尚未执行”。运行报告只展示该次运行结果，未选中的测试显示“本次未执行”。同名测试按文件、完整名称路径和执行环境区分，重复运行单独显示。

### 按功能分类

报告左侧按功能分类，不再平铺测试文件路径。分类优先根据测试套件、非通用目录名和文件名前缀自动推断；多个文件共享前缀时合并为一类，单个文件则使用首个有意义的名称部分。无法推断时归入“其他”。状态仍通过页面上的状态筛选器查看，搜索也会匹配功能名和文件路径。

如果自动分类不符合项目的业务含义，可在消费项目的 `e2r/categories.json` 中维护中文分类。规则按数组顺序匹配，第一条命中生效；文件路径相对项目根目录，支持 `*`、`**` 和 `?` 通配符。`suites` 匹配测试名称路径中的套件名，`tags` 匹配测试标签；同一规则中的条件按“任一命中”处理。

```json
{
  "categories": [
    {
      "name": "账号与认证",
      "match": {
        "files": ["test/e2e/tests/auth*.e2e.ts", "test/e2e/tests/login*.e2e.ts"],
        "tags": ["account"]
      }
    },
    {
      "name": "页面编辑",
      "match": { "files": ["test/e2e/tests/page-edit-*.e2e.ts"] }
    }
  ]
}
```

配置文件是可选的；格式无效时报告会显示警告并回退到自动分类。分类结果会写入生成的 HTML，因此分享报告时不需要额外携带配置文件。

公共选项：

```sh
node e2r/scripts/generate-report.js --framework e2e --catalog-only \
  --project-root /path/to/project --config e2e.config.ts --output e2r-report/report.html
```

默认从当前目录向上寻找所选框架配置，以配置所在目录为项目根目录；也可以显式指定 `--project-root`。相对输入输出路径均相对项目根目录解析。非标准配置文件请使用 `--config`。

## 导入已有运行结果

保留原来的三个位置参数：结果目录、JSON 报告、输出 HTML。

```sh
node e2r/scripts/generate-report.js "" .e2e/report.json e2r-report/report.html
node e2r/scripts/generate-report.js test-results playwright-report/report.json e2r-report/report.html
```

e2e 未指定结果目录时使用 JSON 报告旁边的 `results/`；Playwright 使用附件中记录的路径（相对路径以项目根目录为基准），不会按目录名称猜测媒体归属。支持 Playwright 内嵌附件。e2e 支持 `report-1`。

导入后仍会尝试从原项目刷新目录；缺少框架或配置时，页面明确标记“目录未完整刷新”，仅展示导入结果。无效报告不会覆盖原来的页面。纯目录模式发现失败则报错，不输出空的“完整目录”。

## 查看、交给 AI、分享

打开 `e2r-report/report.html`，按功能浏览或搜索测试名称、文件路径和执行环境。相同文件、测试名称路径和测试类型下的不同执行环境会归在同一场景中；展开具体变体可查看源码位置和执行证据。默认查看最后一次尝试，可切换此前的尝试；串行组共享录屏有明确标记。没有产生媒体和媒体文件缺失会分别提示。

点击“复制给 AI”可复制精确测试名称、源码位置、环境、运行时间、当前尝试、状态、错误摘要和媒体位置。浏览器禁止剪贴板访问时，可在弹出的文本框中手动复制。

分享时复制整个 `e2r-report/`。本地媒体已复制到 `report.media/`，页面不依赖原始结果目录或原电脑的绝对路径。托管在远端的视频保留链接，需要网络及相应访问权限。

自定义输出为 `foo.html` 时，媒体目录是同级的 `foo.media/`，也需要按项目规则忽略。生成器只清理自己的媒体清单，不删除输出目录中的其他文件。生成失败会提示“报告未更新”，不会改变测试本身的结果。

## 本仓库开发

```sh
npm ci
npx playwright install chromium
npm test
npm run generate:demo
```

回归测试的固定媒体和示例 JSON 是源码资料，保留在 Git 中；运行生成物放在 `e2r-report/`。测试会在临时目录验证两个框架、实际视频播放、目录迁移与 Git 克隆后的接入。
