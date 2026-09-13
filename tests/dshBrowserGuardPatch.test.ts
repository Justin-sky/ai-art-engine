import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BROWSER_GUARD_MARKER,
  BROWSER_GUARD_MESSAGE,
  BROWSER_GUARD_SNIPPET,
  SUBPROCESS_LOCAL_PACKAGE,
  blockBrowserLaunchReason,
  patchBrowserGuard,
  patchBrowserGuardSource
} from '../src/main/services/dshBrowserGuardPatch'

/**
 * 浏览器启动守卫的契约：在共享子进程收口 `LocalSubprocessRuntime.spawn(spec)` 与
 * `spawnTerminal(spec)` 的方法体开头插入按 argv 的判定，命中「启动浏览器」特征时不创建进程
 * 而是抛出可读原因——这样模型拿到的是工具错误，用户不再被 msedge 的 0x80000003 系统模态框打断。
 *
 * 判定规则有明确的宽严取舍：
 * - 程序位（argv[0]、`--` 之后）是浏览器 → 一律拦（零误伤）；
 * - 程序位是 shell 时才判定参数文本：Chromium 自动化开关出现即拦，浏览器名字命中后还要过
 *   一遍「检查 / 清理」语境才拦；
 * - 程序位不是 shell（rg / taskkill / node 等）→ 参数文本完全不管，`rg -e msedge` 不会被误伤。
 *
 * 用例取自真实的越界命令（会话日志里的 `$edge='…msedge.exe'` + `& $edge …`）与其被沙箱
 * 重包后的 argv 形状。
 */

/** pwsh 执行器生成的命令行文本（与 dsh-pwsh-local 同形：编码前导 + 用户命令） */
const BOUNDARY_COMMAND = [
  "$edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'",
  '& $edge --version',
  '& $edge --headless=new --disable-gpu --hide-scrollbars --window-size=900,711 --screenshot="C:\\tmp\\_test_render.png" "C:\\tmp\\aa-vector-portrait.svg" 2>&1 | Out-String'
].join('\n')

/** 直连链路：pwsh 执行器交给收口点的 argv */
const PWSH_ARGV = [
  'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  BOUNDARY_COMMAND
]

/** 沙箱链路：ACL 沙箱把真实 argv 包在 runner 之后，真正的程序位在 `--` 后面 */
const SANDBOX_ARGV = [
  'C:\\Program Files\\aiartengine\\node.exe',
  'C:\\Program Files\\aiartengine\\resources\\dsh\\node_modules\\@deepseek-ai\\dsh-subprocess-local\\lib\\runner.js',
  '--temp-write-sid',
  'S-1-4-1',
  '--',
  ...PWSH_ARGV
]

/** 与上游同形的两个收口点定义，外加一个不该动的「接收 argv 参数」的方法当干扰项 */
const FIXTURE = [
  '\t/** Spawn one subprocess against the local runtime. */',
  '\tspawn(spec) {',
  '\t\tvalidateSubprocessSpec(spec);',
  '\t\treturn launch(spec);',
  '\t}',
  '\t/** Map one resolved spec plus its argv onto a spawn. */',
  '\tspawnSpec(spec, stdoutMaxBytes, signal, argv) {',
  '\t\treturn { argv: [...argv] };',
  '\t}',
  '\tasync spawnTerminal(spec) {',
  '\t\tconst file = spec.argv[0];',
  '\t\treturn start(file);',
  '\t}'
].join('\n')

/** 真实产物位置：没装依赖时为 undefined */
const subprocessLocalLibDir = join(
  process.cwd(),
  'node_modules',
  ...SUBPROCESS_LOCAL_PACKAGE.split('/'),
  'lib'
)
const subprocessLocalSourcePath = existsSync(subprocessLocalLibDir)
  ? (() => {
      const name = readdirSync(subprocessLocalLibDir).find(
        (entry) => entry === 'index.js' || /\.js$/.test(entry)
      )
      return name ? join(subprocessLocalLibDir, name) : undefined
    })()
  : undefined

/** 临时依赖树：<tmp>/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js */
function makeTempModulesDir(source: string): {
  modulesDir: string
  file: string
  cleanup: () => void
} {
  const root = mkdtempSync(join(tmpdir(), 'aiart-browser-guard-'))
  const modulesDir = join(root, 'node_modules')
  const libDir = join(modulesDir, ...SUBPROCESS_LOCAL_PACKAGE.split('/'), 'lib')
  mkdirSync(libDir, { recursive: true })
  const file = join(libDir, 'index.js')
  writeFileSync(file, source, 'utf8')
  return { modulesDir, file, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** 把注入片段编译成函数：验证「真正写进产物里的那段代码」的行为 */
function compileSnippet(): (argv: readonly unknown[]) => string | null {
  const factory = new Function(`${BROWSER_GUARD_SNIPPET}; return __aiartBrowserLaunchGuard`)
  return factory() as (argv: readonly unknown[]) => string | null
}

/** 注入块（含包裹用的花括号）的原文，用于往返还原断言 */
const INJECTED_BLOCK =
  /\r?\n\t+\/\/ AIArtEngine: refuse browser launches at the subprocess seam\.[\s\S]*?\r?\n\t+\}(?!;)/g

describe('浏览器守卫（判定表）', () => {
  /** 程序位是浏览器，或 shell 命令文本里出现启动特征 */
  const blocked: Array<[string, string[]]> = [
    ['直连链路：变量存路径 + 调用运算符 + 无头截图', PWSH_ARGV],
    ['沙箱链路：argv 被 runner 包在 `--` 之后', SANDBOX_ARGV],
    [
      '裸名无头截图',
      [
        'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        '-Command',
        'msedge --headless --screenshot=out.png page.html'
      ]
    ],
    [
      '绝对路径 + --dump-dom',
      [
        'pwsh.exe',
        '-Command',
        '& "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --dump-dom https://example.com'
      ]
    ],
    [
      'Chromium 调试端口',
      [
        'pwsh.exe',
        '-Command',
        'chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\\tmp\\profile'
      ]
    ],
    [
      'Playwright CLI 截图',
      ['pwsh.exe', '-Command', 'npx playwright screenshot https://example.com out.png']
    ],
    ['Puppeteer 脚本', ['pwsh.exe', '-Command', 'node -e "require(\'puppeteer\').launch()"']],
    [
      'Start-Process 启动',
      [
        'pwsh.exe',
        '-Command',
        'Start-Process "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"'
      ]
    ],
    [
      '清理残留后立刻启动：硬开关优先于放行语境',
      [
        'pwsh.exe',
        '-Command',
        'taskkill /IM msedge.exe /F\nmsedge --headless --screenshot=a.png b.html'
      ]
    ],
    [
      '程序位直接就是浏览器（不经过 shell）',
      [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        '--headless=new',
        '--screenshot=out.png'
      ]
    ],
    [
      '程序位是自动化入口',
      ['npx.cmd', 'playwright', 'screenshot', 'https://example.com', 'out.png']
    ]
  ]

  it.each(blocked)('拦截：%s', (_name, argv) => {
    expect(blockBrowserLaunchReason(argv)).toBe(BROWSER_GUARD_MESSAGE)
  })

  /** 程序位不是 shell（搜索 / 终止 / 查询工具）时参数文本完全不管，避免误伤 */
  const allowed: Array<[string, unknown[]]> = [
    ['空 argv', []],
    [
      'rg 把浏览器名当搜索词',
      ['C:\\aiart\\rg.exe', '--json', '-e', 'msedge', '--glob', '!node_modules', 'src']
    ],
    [
      'rg 把 --headless 当搜索词（`--` 之后是普通文本）',
      ['C:\\aiart\\rg.exe', '-e', 'chrome', '--', '--headless']
    ],
    ['rg 搜 playwright', ['rg.exe', '-n', 'playwright', 'package.json']],
    ['taskkill 清理（程序位不是 shell，也不是浏览器）', ['taskkill', '/IM', 'msedge.exe', '/F']],
    [
      '终端启动（argv 只有 shell 本身，没有命令文本）',
      ['C:\\Program Files\\PowerShell\\7\\pwsh.exe']
    ],
    ['普通只读命令', ['pwsh.exe', '-NoLogo', '-Command', 'Get-ChildItem .']],
    ['检查语境：查询进程', ['pwsh.exe', '-Command', 'Get-Process msedge']],
    ['检查语境：终止进程', ['pwsh.exe', '-Command', 'Stop-Process -Name msedge -Force']],
    [
      '检查语境：删缓存目录',
      [
        'pwsh.exe',
        '-Command',
        'Remove-Item "C:\\Users\\PS\\AppData\\Local\\Temp\\chrome-*" -Recurse -Force'
      ]
    ],
    ['检查语境：读源码文件', ['pwsh.exe', '-Command', 'Get-Content src/renderer/chrome.ts']],
    ['检查语境：where.exe 查询', ['pwsh.exe', '-Command', 'where.exe chrome']],
    [
      '检查语境：日志里搜名字',
      ['pwsh.exe', '-Command', 'Select-String -Path "C:\\temp\\log.txt" -Pattern msedge']
    ],
    ['非字符串项不参与判定（也不炸）', ['pwsh.exe', '-Command', 'Get-ChildItem .', undefined, null]]
  ]

  it.each(allowed)('放行：%s', (_name, argv) => {
    expect(blockBrowserLaunchReason(argv)).toBeNull()
  })

  it('注入片段与 TS 判定函数逐例同结果（防漂移）', () => {
    const snippetGuard = compileSnippet()
    for (const [name, argv] of blocked) {
      const actual = snippetGuard(argv)
      expect(actual, name).toBe(blockBrowserLaunchReason(argv))
      expect(actual, name).toBe(BROWSER_GUARD_MESSAGE)
    }
    for (const [name, argv] of allowed) {
      expect(snippetGuard(argv), name).toBe(blockBrowserLaunchReason(argv))
    }
  })

  it('拒绝原因里写清了「换写法也没用」与替代路径', () => {
    expect(BROWSER_GUARD_MESSAGE).toContain('render_svg')
    expect(BROWSER_GUARD_MESSAGE).toContain('Do not retry with another browser')
    expect(BROWSER_GUARD_MESSAGE).toContain('every browser launch on this machine is refused')
    expect(BROWSER_GUARD_MESSAGE).toContain('ask the user to run it outside the app')
  })
})

describe('浏览器守卫（源码改写）', () => {
  it('在两个收口点开头各插入一处守卫，且除插入外不动任何字节', () => {
    const { source, sites } = patchBrowserGuardSource(FIXTURE)

    expect(sites).toBe(2)
    expect(source).toContain(`const ${BROWSER_GUARD_MARKER} = (argv) => {`)
    expect(source).toContain('if (__aiartBlocked !== null) throw new Error(__aiartBlocked);')
    expect(source).toContain('const __aiartBlocked = __aiartBrowserLaunchGuard(spec?.argv);')
    // 两个锚点都被插入：spawn(spec) 与 async spawnTerminal(spec)
    expect(
      (source.match(/\/\/ AIArtEngine: refuse browser launches at the subprocess seam\./g) ?? [])
        .length
    ).toBe(2)
    expect(source).toContain('\tasync spawnTerminal(spec) {')
    // 守卫插在方法体最前面：仍在原有的语句之前
    expect(source.indexOf(BROWSER_GUARD_MARKER)).toBeLessThan(
      source.indexOf('validateSubprocessSpec(spec)')
    )
    expect(source.indexOf(BROWSER_GUARD_MARKER)).toBeLessThan(
      source.indexOf('const file = spec.argv[0];')
    )
    // 收 argv 参数的另一个方法不该被插入
    expect(source.indexOf(BROWSER_GUARD_MARKER)).toBeLessThan(source.indexOf('spawnSpec('))
    expect((source.match(/const __aiartBrowserLaunchGuard = \(argv\) => \{/g) ?? []).length).toBe(2)
    // 片段里若出现反引号或 ${ 会破坏构建脚本的抽取正则
    expect(BROWSER_GUARD_SNIPPET).not.toContain('`')
    expect(BROWSER_GUARD_SNIPPET).not.toContain('${')

    // 往返还原：删掉两处插入的守卫块后与原文逐字相同
    // （`(?!;)`：片段里有以 `};` 结尾的语句，没有它非贪婪会在那里提前收尾）
    const removed = source.replace(INJECTED_BLOCK, '')
    expect(removed).toBe(FIXTURE)
  })

  it('CRLF 源码沿用 CRLF 插入，不混入 LF', () => {
    const crlf = FIXTURE.replace(/\n/g, '\r\n')
    const { source, sites } = patchBrowserGuardSource(crlf)

    expect(sites).toBe(2)
    expect(source).toContain(
      '\r\n\t\t// AIArtEngine: refuse browser launches at the subprocess seam.'
    )
    expect(source).not.toMatch(/[^\r]\n\t\tconst __aiartBrowserLaunchGuard/)
  })

  it('幂等：已是补丁状态再补一次不改动任何字节', () => {
    const once = patchBrowserGuardSource(FIXTURE)
    const twice = patchBrowserGuardSource(once.source)

    expect(twice.sites).toBe(0)
    expect(twice.source).toBe(once.source)
  })

  it('没有锚点（上游换实现）时原样返回', () => {
    const plain = 'export function run(argv) { return spawnPty(argv); }'
    expect(patchBrowserGuardSource(plain)).toEqual({ source: plain, sites: 0 })
  })
})

describe('浏览器守卫（依赖树落盘）', () => {
  it.skipIf(process.platform !== 'win32')(
    '命中收口包时写盘（两处），二次调用只报「已补丁」',
    () => {
      const { modulesDir, file, cleanup } = makeTempModulesDir(FIXTURE)
      try {
        expect(patchBrowserGuard(modulesDir)).toEqual({
          present: true,
          patchedFiles: 1,
          patchedSites: 2,
          alreadyFiles: 0,
          failedFiles: 0
        })
        expect(readFileSync(file, 'utf8')).toContain(BROWSER_GUARD_MARKER)

        expect(patchBrowserGuard(modulesDir)).toEqual({
          present: true,
          patchedFiles: 0,
          patchedSites: 0,
          alreadyFiles: 1,
          failedFiles: 0
        })
      } finally {
        cleanup()
      }
    }
  )

  it.skipIf(process.platform !== 'win32')('依赖树里没有收口包时返回未命中，且不抛错', () => {
    const { modulesDir, cleanup } = makeTempModulesDir(FIXTURE)
    try {
      rmSync(join(modulesDir, ...SUBPROCESS_LOCAL_PACKAGE.split('/')), {
        recursive: true,
        force: true
      })
      expect(patchBrowserGuard(modulesDir)).toEqual({
        present: false,
        patchedFiles: 0,
        patchedSites: 0,
        alreadyFiles: 0,
        failedFiles: 0
      })
    } finally {
      cleanup()
    }
  })
})

describe.skipIf(!subprocessLocalSourcePath)('浏览器守卫（真实运行体产物）', () => {
  it('上游产物可被插入两处守卫，插入后仍是合法 ESM', () => {
    const source = readFileSync(subprocessLocalSourcePath!, 'utf8')
    const { source: patched, sites } = patchBrowserGuardSource(source)

    if (sites === 0) {
      // 该文件可能已被运行时补丁就地改过（在装了依赖的本机跑过应用即如此）
      expect(source).toContain(BROWSER_GUARD_MARKER)
    } else {
      expect(sites).toBe(2)
    }
    expect(patched).toContain(BROWSER_GUARD_MARKER)
    // 收口点确实带着 spec.argv（spawn 用它建 scope / job，spawnTerminal 取 argv[0] 当程序）
    expect(patched).toContain('spec.argv')
    expect(patched).toContain('spec.argv[0]')
    expect(patched).toMatch(/spawn\(spec\) \{\r?\n(\t+)\/\/ AIArtEngine: refuse browser launches/)
    expect(patched).toMatch(
      /async spawnTerminal\(spec\) \{\r?\n(\t+)\/\/ AIArtEngine: refuse browser launches/
    )

    // 语法仍然合法（ESM 解析，不解析 import 目标）
    const dir = mkdtempSync(join(tmpdir(), 'aiart-browser-guard-syntax-'))
    const probe = join(dir, 'index-probe.mjs')
    try {
      writeFileSync(probe, patched, 'utf8')
      const res = spawnSync(process.execPath, ['--check', probe], {
        encoding: 'utf8',
        windowsHide: true
      })
      expect(res.status, res.stderr).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('构建期补丁与运行时补丁的口径一致（防漂移）', () => {
  it('构建脚本能按同一正则从运行时模块抽出与常量逐字相同的守卫片段', () => {
    const module = readFileSync(
      join(process.cwd(), 'src/main/services/dshBrowserGuardPatch.ts'),
      'utf8'
    )
    const match = module.match(/export const BROWSER_GUARD_SNIPPET = String\.raw`([\s\S]*?)`/)

    expect(match).not.toBeNull()
    expect(match![1].replace(/\r\n/g, '\n').trim()).toBe(BROWSER_GUARD_SNIPPET)
  })

  it('bundle-dsh.mjs 用同一个锚点与标志，并从运行时模块抽守卫片段', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'bundle-dsh.mjs'), 'utf8')

    expect(script).toContain(BROWSER_GUARD_MARKER)
    expect(script).toContain('@deepseek-ai/dsh-subprocess-local')
    expect(script).toContain('spawn\\(spec\\) \\{')
    expect(script).toContain('async spawnTerminal\\(spec\\) \\{')
    expect(script).toContain('__aiartBrowserLaunchGuard(spec?.argv)')
    // 片段来源指向运行时补丁模块，避免构建期维护第二份判定逻辑
    expect(script).toContain('src/main/services/dshBrowserGuardPatch.ts')
    expect(script).toContain('BROWSER_GUARD_SNIPPET')
    // 构建脚本顺带覆盖了运行时补丁模块本身，防止「改了运行时忘了构建期」
    const module = readFileSync(
      join(process.cwd(), 'src/main/services/dshBrowserGuardPatch.ts'),
      'utf8'
    )
    expect(module).toContain('export const BROWSER_GUARD_SNIPPET = String.raw`')
    expect(module).toContain(BROWSER_GUARD_MARKER)
  })
})
