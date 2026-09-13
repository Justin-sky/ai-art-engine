/**
 * 「沙箱内禁止启动浏览器」运行时补丁（仅 Windows 生效），收口在**共享子进程入口**。
 *
 * 背景：agent 为给 SVG / HTML 产物做视觉自查，会起本机浏览器截图（实测命令：
 * `$edge='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'` +
 * `& $edge --headless=new --screenshot=...`）。命令跑在 dsh 的 Windows ACL 沙箱里
 * （受限令牌 + CreateProcessAsUserW），Chromium 在该令牌下建不出自己的 mojo IPC 命名管道，
 * 于是 CHECK 失败 → `__debugbreak` → `0x80000003`，系统**在应用之外**弹出模态
 * 「应用程序错误」框挡在用户面前，而工具调用照样失败。
 *
 * 提示词侧的软约束（persona 的 headless-browser 段）压不住这种行为：模型第一次被拦住后
 * 会换写法（把路径存进变量、用调用运算符 `&`、`--version` 试探……），而沙箱只有文件效果
 * 策略、没有进程策略。唯一能确定生效的位置是**进程创建处**。
 *
 * 为什么收口在 `LocalSubprocessRuntime`（`@deepseek-ai/dsh-subprocess-local`）而不是某个
 * 执行器：Windows 上 `dsh-base` 只启用 `pwsh-sandbox` / `tool-pwsh`（`bash-sandbox` 与
 * `tool-bash` 是 `disabled: process.platform === 'win32'`），而 pwsh 的两条链路——
 * 直连（`run` / `start`）与沙箱（`dsh-pwsh-sandbox` 的 `confine()` 重包 argv）——最终都走
 * `runArgv` / `startArgv` → `ctx.subprocess.spawn(spec)`；终端的 `spawnTerminal(spec)` 同理。
 * 因此 `spawn(spec)` 与 `spawnTerminal(spec)` 是这台机器上所有 shell 进程的必经点：
 * 一处插入即覆盖全部执行器，且**不依赖任何执行器包的内部结构**（上游换实现只影响锚点，
 * 见下）。同一棵依赖树里 `bash-local` / `fs-search`（rg）/ 终端也都经由这里。
 *
 * 修法：在两个方法体开头插入守卫，命中「启动浏览器」特征就在创建进程之前抛出可读原因
 * （模型看到的是工具错误，能据此改用 studio 的 `render_svg` 工具直接拿到栅格化结果）。
 *
 * 判定分两条，都是为了「一处收口但不误伤」：
 * 1. **程序位**（argv[0]，以及 `--` 之后的元素——ACL 沙箱把真实 argv 包在 runner 之后）里
 *    直接就是浏览器可执行文件 → 拦。零误伤：`taskkill /IM msedge.exe` 的 msedge 不在程序位。
 * 2. 程序位里出现 **shell / 命令运行器**（pwsh / cmd / bash / npx …）时，才把整条命令行当
 *    文本判定：Chromium 自动化开关（--headless 等）出现即拦；浏览器名字命中后还要过一遍
 *    「检查 / 清理语境」才放行。这样 `rg --headless` 这类把开关当**搜索词**的命令不会误伤
 *    （程序位是 rg，不是命令行）。
 *
 * 守卫仍是**文本判定**，边界写在明处：拆字符串拼路径、写脚本再执行、或用自动化工具自带的
 * 私有 Chromium 副本仍可能绕过——那属于下一条防线（抑制系统弹框）的事，先解决高频形态。
 * 上游换实现即自然失效：找不到 `spawn(spec) {` / `async spawnTerminal(spec) {` 锚点就静默
 * 跳过，绝不抛错、绝不拖累对话。独立成模块（不 import electron）以便单测直接加载；
 * 模块内不出现中文字符串字面量。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 子进程收口包名：local 运行时（`spawn` / `spawnTerminal` 的定义处） */
export const SUBPROCESS_LOCAL_PACKAGE = '@deepseek-ai/dsh-subprocess-local'

/** 补丁标志：命中说明该文件已经打过补丁（幂等判定锚点），也是注入片段的函数名 */
export const BROWSER_GUARD_MARKER = '__aiartBrowserLaunchGuard'

/**
 * 拒绝时回给模型的原因（英文，与 persona 口径一致）。
 *
 * 必须写清「换写法也没用」与「正确替代路径」：模型在拿到这条错误后应当停止重试浏览器，
 * 转向 `render_svg` 工具拿栅格化结果，或把浏览器验证交回用户。
 */
export const BROWSER_GUARD_MESSAGE = [
  'AIArtEngine sandbox policy: this command may not launch a browser.',
  'Chromium cannot create its internal IPC pipe under the sandbox restricted token, so it aborts',
  'with 0x80000003 and Windows raises a modal application-error dialog in front of the user while',
  'the command fails anyway.',
  'Do not retry with another browser, another install path, --no-sandbox, or a renamed copy:',
  'every browser launch on this machine is refused the same way.',
  'To rasterize or visually check a vector or HTML artifact, call the studio tool render_svg instead:',
  'it renders the file with the app own engine and returns the PNG frames as images you can look at,',
  'with no browser involved.',
  'If a check genuinely needs a real browser, stop and ask the user to run it outside the app.'
].join(' ')

/**
 * 注入到产物源码里的守卫片段（原样插进 `spawn(spec)` / `async spawnTerminal(spec)` 方法体）。
 *
 * 用 `String.raw` 保存 `\b`、`\r\n` 等转义：这是要写进别人源码的文本，不能先被 TS 解一层。
 * 片段内不出现反引号与 `${`，因此构建脚本（scripts/bundle-dsh.mjs，不能 import TS）可以用
 * 同一个正则从本文件里抽走这段文本，两边零漂移（构建侧同样把 CRLF 规范成 LF）。
 */
export const BROWSER_GUARD_SNIPPET = String.raw`
const __aiartBrowserLaunchGuard = (argv) => {
  const message = "AIArtEngine sandbox policy: this command may not launch a browser. Chromium cannot create its internal IPC pipe under the sandbox restricted token, so it aborts with 0x80000003 and Windows raises a modal application-error dialog in front of the user while the command fails anyway. Do not retry with another browser, another install path, --no-sandbox, or a renamed copy: every browser launch on this machine is refused the same way. To rasterize or visually check a vector or HTML artifact, call the studio tool render_svg instead: it renders the file with the app own engine and returns the PNG frames as images you can look at, with no browser involved. If a check genuinely needs a real browser, stop and ask the user to run it outside the app.";
  // Chromium automation switches: never legitimate in a sandboxed command.
  const flags = /--headless|--screenshot|--dump-dom|--print-to-pdf|--remote-debugging-port/i;
  // Browser executables and automation entry points, bare name or full path.
  const names = /\b(?:msedge|chrome|chromium|headless_shell|chrome-headless-shell|playwright|puppeteer|chromedriver)\b/i;
  // A name mentioned after an inspection verb (kill / query / file IO) is not a launch.
  const inspection = /\b(?:taskkill|stop-process|get-process|remove-item|test-path|get-item|get-childitem|get-command|get-content|select-string|set-content|copy-item|move-item|new-item|where)\b[^;\r\n|&]{0,80}?\b(?:msedge|chrome|chromium|headless_shell|chrome-headless-shell)\b/i;
  // A program position that names a browser is a launch (argv[0], and the real argv a sandbox
  // runner wraps after "--").
  const browserProgram = /^(?:msedge|chrome|chromium|chrome-headless-shell|headless_shell|chromedriver|playwright|puppeteer)(?:\.(?:exe|cmd|bat|ps1))?$/;
  // Shells and command runners: only their argument text is judged, so a search tool pattern is
  // never misread (rg / taskkill / node programs are not in this set).
  const payloadProgram = /^(?:pwsh|powershell|cmd|bash|sh|zsh|dash|wsl|npx|pnpx)(?:\.(?:exe|cmd|bat))?$/;
  if (!Array.isArray(argv) || argv.length === 0) return null;
  const name = (value) => {
    const text = String(value ?? "");
    const cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
    return (cut >= 0 ? text.slice(cut + 1) : text).toLowerCase();
  };
  const positions = [0];
  for (let index = argv.indexOf("--"); index >= 0; index = argv.indexOf("--", index + 1)) positions.push(index + 1);
  let payload = false;
  for (const index of positions) {
    const program = name(argv[index]);
    if (browserProgram.test(program)) return message;
    if (payloadProgram.test(program)) payload = true;
  }
  if (!payload) return null;
  const text = argv.map((item) => (typeof item === "string" ? item : "")).join(" ");
  if (flags.test(text)) return message;
  if (!names.test(text)) return null;
  if (inspection.test(text)) return null;
  return message;
};
`
  // 行的分隔统一成 LF：模板字符串的行尾取决于源文件，注入时再按产物行尾拼回
  .replace(/\r\n/g, '\n')
  .trim()

/** 改写结果：新源码 + 本次插入的守卫点数 */
export interface BrowserGuardSourcePatch {
  source: string
  sites: number
}

/** 打补丁结果（按文件与插入点分别计数，便于日志与测试断言） */
export interface BrowserGuardReport {
  /** 是否命中子进程收口包：false = 这棵依赖树没有该链路，无需补丁 */
  present: boolean
  /** 本次实际写入补丁的文件数 */
  patchedFiles: number
  /** 本次插入的守卫点数 */
  patchedSites: number
  /** 已是补丁状态、跳过的文件数 */
  alreadyFiles: number
  /** 读写失败的文件数（只读安装目录、被安全软件锁定等） */
  failedFiles: number
}

/**
 * 触发判定的正则（供测试与文档引用；注入片段里有同源的副本）。
 *
 * `BROWSER_GUARD_FLAGS` 是 Chromium 自动化开关，出现即拦；`BROWSER_GUARD_NAMES` 是浏览器
 * 可执行名与自动化入口，命中后还要过一遍「检查/清理语境」（`BROWSER_GUARD_INSPECTION`）
 * 才拦；两条都只在程序位里出现 shell / 命令运行器时才生效。`BROWSER_GUARD_PROGRAMS` 判定
 * 程序位本身就是浏览器（不受文本语境影响），`BROWSER_GUARD_PAYLOADS` 判定是否需要做文本判定。
 */
export const BROWSER_GUARD_FLAGS =
  /--headless|--screenshot|--dump-dom|--print-to-pdf|--remote-debugging-port/i
export const BROWSER_GUARD_NAMES =
  /\b(?:msedge|chrome|chromium|headless_shell|chrome-headless-shell|playwright|puppeteer|chromedriver)\b/i
/** 检查/清理语境：命中的名字只是被查询、终止或读写，不算启动 */
export const BROWSER_GUARD_INSPECTION =
  /\b(?:taskkill|stop-process|get-process|remove-item|test-path|get-item|get-childitem|get-command|get-content|select-string|set-content|copy-item|move-item|new-item|where)\b[^;\r\n|&]{0,80}?\b(?:msedge|chrome|chromium|headless_shell|chrome-headless-shell)\b/i
/** 程序位是浏览器可执行文件（含自动化入口） */
export const BROWSER_GUARD_PROGRAMS =
  /^(?:msedge|chrome|chromium|chrome-headless-shell|headless_shell|chromedriver|playwright|puppeteer)(?:\.(?:exe|cmd|bat|ps1))?$/
/** 程序位是 shell / 命令运行器：其后的参数文本才需要判定（`npx playwright …` 也算命令行） */
export const BROWSER_GUARD_PAYLOADS =
  /^(?:pwsh|powershell|cmd|bash|sh|zsh|dash|wsl|npx|pnpx)(?:\.(?:exe|cmd|bat))?$/

/** 取程序位上的可执行名（去目录、统一小写） */
function programName(value: unknown): string {
  const text = String(value ?? '')
  const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  return (cut >= 0 ? text.slice(cut + 1) : text).toLowerCase()
}

/**
 * 取 argv 里的「程序位」下标：argv[0]，以及每个 `--` 之后的那一项。
 *
 * 后者是为沙箱链路准备的：ACL 沙箱把真实 argv 包在 runner 之后，`node runner.js … -- pwsh …`，
 * 真正的程序名在 `--` 后面。拿不准时多取几个下标只是让「程序位是浏览器」多命中几次，
 * 而 `rg -- pattern` 这种把 `--` 当分隔符的调用，后面那一项是普通文本，不会命中浏览器名。
 */
function programPositions(argv: readonly unknown[]): number[] {
  const positions = [0]
  for (let index = argv.indexOf('--'); index >= 0; index = argv.indexOf('--', index + 1)) {
    positions.push(index + 1)
  }
  return positions
}

/**
 * 纯函数（与注入片段同构，供单测与人工阅读）：命中返回拒绝原因，放行返回 null。
 *
 * 判定顺序：空 argv 放行 → 程序位是浏览器直接拦 → 程序位里没有 shell / 命令运行器就放行
 * （不是命令行，参数文本不做判定，`rg -e msedge` 因此不会误伤）→ 自动化开关直接拦 →
 * 没有浏览器名字放行 → 检查/清理语境放行 → 其余一律拦。宁可宽拦：拦错的代价是模型换一种
 * 写法（错误信息里写清了替代路径），漏拦的代价是用户被系统模态框打断。
 */
export function blockBrowserLaunchReason(argv: readonly unknown[]): string | null {
  if (!Array.isArray(argv) || argv.length === 0) return null
  const positions = programPositions(argv)
  let payload = false
  for (const index of positions) {
    const program = programName(argv[index])
    if (BROWSER_GUARD_PROGRAMS.test(program)) return BROWSER_GUARD_MESSAGE
    if (BROWSER_GUARD_PAYLOADS.test(program)) payload = true
  }
  if (!payload) return null
  const text = argv.map((item) => (typeof item === 'string' ? item : '')).join(' ')
  if (BROWSER_GUARD_FLAGS.test(text)) return BROWSER_GUARD_MESSAGE
  if (!BROWSER_GUARD_NAMES.test(text)) return null
  if (BROWSER_GUARD_INSPECTION.test(text)) return null
  return BROWSER_GUARD_MESSAGE
}

/**
 * 纯函数：把源码里 `spawn(spec)` 与 `async spawnTerminal(spec)` 的方法体开头插入浏览器守卫。
 *
 * 上游只有这两个定义点，且是这台机器上所有 shell 进程的必经点（直连 / 沙箱 / 终端）。
 * 已是补丁状态时原样返回（幂等）。
 */
export function patchBrowserGuardSource(source: string): BrowserGuardSourcePatch {
  if (source.includes(BROWSER_GUARD_MARKER)) return { source, sites: 0 }

  let sites = 0
  // 每次调用都新建正则：带 g 的正则留在模块级会带 lastIndex 状态，容易埋雷
  const anchors = [
    /(\r?\n)([ \t]*)spawn\(spec\) \{/,
    /(\r?\n)([ \t]*)async spawnTerminal\(spec\) \{/
  ]

  let patched = source
  for (const anchor of anchors) {
    patched = patched.replace(anchor, (_match: string, eol: string, indent: string) => {
      sites += 1
      const body = `${indent}\t`
      const snippet = BROWSER_GUARD_SNIPPET.split('\n')
        .map((line) => (line.length > 0 ? `${body}${line}` : line))
        .join(eol)
      const head = anchor.source.includes('spawnTerminal')
        ? 'async spawnTerminal(spec) {'
        : 'spawn(spec) {'
      return [
        `${eol}${indent}${head}`,
        `${eol}${body}// AIArtEngine: refuse browser launches at the subprocess seam.`,
        `${eol}${body}{`,
        `${eol}${snippet}`,
        `${eol}${body}\tconst __aiartBlocked = __aiartBrowserLaunchGuard(spec?.argv);`,
        `${eol}${body}\tif (__aiartBlocked !== null) throw new Error(__aiartBlocked);`,
        `${eol}${body}}`
      ].join('')
    })
  }

  return { source: patched, sites }
}

/**
 * 对一棵 dsh 依赖树（其 `node_modules` 目录）里的子进程收口打浏览器启动守卫补丁。
 *
 * 只读失败、写盘失败、目录不存在都在此消化：调用方拿到的是报告而不是异常——补丁出问题
 * 时对话照旧（只是又回到「模型起浏览器 → 弹系统框」的老样子），不该因此中断任务。
 */
export function patchBrowserGuard(dshModulesDir: string): BrowserGuardReport {
  const report: BrowserGuardReport = {
    present: false,
    patchedFiles: 0,
    patchedSites: 0,
    alreadyFiles: 0,
    failedFiles: 0
  }
  if (process.platform !== 'win32') return report

  const libDir = join(dshModulesDir, ...SUBPROCESS_LOCAL_PACKAGE.split('/'), 'lib')
  if (!existsSync(libDir)) return report
  report.present = true

  for (const file of listJsFiles(libDir)) {
    try {
      const source = readFileSync(file, 'utf8')
      // 收口定义只在 index.js；runner 等旁路文件连判定都省掉
      if (!source.includes('spawn(spec)')) continue
      if (source.includes(BROWSER_GUARD_MARKER)) {
        report.alreadyFiles += 1
        continue
      }
      const { source: patched, sites } = patchBrowserGuardSource(source)
      if (sites === 0) continue
      writeFileSync(file, patched, 'utf8')
      report.patchedFiles += 1
      report.patchedSites += sites
    } catch (error) {
      report.failedFiles += 1
      console.warn('[aiart] subprocess browser guard patch failed:', file, error)
    }
  }
  return report
}

/** 列出收口包 `lib/` 下的 JS 文件（递归以适配上游改名与文件拆分） */
function listJsFiles(dir: string): string[] {
  const files: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.[cm]?js$/.test(entry.name)) files.push(path)
    }
  }
  walk(dir)
  return files
}
