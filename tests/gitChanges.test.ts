import { describe, expect, it } from 'vitest'
import {
  buildUntrackedDiff,
  classifyGitStatus,
  fingerprintMap,
  isSafeRelativePath,
  mergeGitChangeFiles,
  normalizeNumstatPath,
  parseGitNumstat,
  parseGitStatusPorcelain,
  parseUnifiedDiff,
  selectChangedFiles,
  type GitChangeFile
} from '../src/shared/git'

describe('git status porcelain 解析', () => {
  it('解析普通状态、未跟踪文件与 rename 的原始路径', () => {
    // 注意 porcelain -z 的 rename 记录：`XY 新路径\0旧路径\0`（旧路径是单独字段）
    const stdout = ' M src/a.ts\0?? docs/新文件.md\0R  src/new.ts\0src/old.ts\0'
    expect(parseGitStatusPorcelain(stdout)).toEqual([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'docs/新文件.md', status: 'untracked' },
      { path: 'src/new.ts', status: 'renamed', oldPath: 'src/old.ts' }
    ])
  })

  it('忽略空字段与残缺记录', () => {
    expect(parseGitStatusPorcelain('\0\0 M x.ts\0ab\0')).toEqual([
      { path: 'x.ts', status: 'modified' }
    ])
  })

  it('归类 XY 两位：冲突优先于删除、索引新增算新增', () => {
    expect(classifyGitStatus('?', '?')).toBe('untracked')
    expect(classifyGitStatus('U', 'U')).toBe('conflicted')
    expect(classifyGitStatus('D', 'D')).toBe('conflicted')
    expect(classifyGitStatus('A', 'A')).toBe('conflicted')
    expect(classifyGitStatus('A', 'M')).toBe('added')
    expect(classifyGitStatus(' ', 'D')).toBe('deleted')
    expect(classifyGitStatus('M', 'M')).toBe('modified')
    expect(classifyGitStatus('C', ' ')).toBe('copied')
  })
})

describe('numstat 解析', () => {
  it('解析增删行数、二进制与折叠路径', () => {
    const stats = parseGitNumstat(
      [
        '12\t3\tsrc/a.ts',
        '-\t-\tassets/logo.png',
        '1\t1\tsrc/{old => new}/x.ts',
        '2\t0\tsrc/one.ts => src/two.ts',
        ''
      ].join('\n')
    )
    expect(stats.get('src/a.ts')).toEqual({ additions: 12, deletions: 3, binary: false })
    expect(stats.get('assets/logo.png')).toEqual({ additions: 0, deletions: 0, binary: true })
    expect(stats.get('src/new/x.ts')).toEqual({ additions: 1, deletions: 1, binary: false })
    expect(stats.get('src/two.ts')).toEqual({ additions: 2, deletions: 0, binary: false })
  })

  it('normalizeNumstatPath 还原三种 rename 形态', () => {
    expect(normalizeNumstatPath('src/{old => new}/x.ts')).toBe('src/new/x.ts')
    expect(normalizeNumstatPath('a.ts => b.ts')).toBe('b.ts')
    expect(normalizeNumstatPath('{old => new}/x.ts')).toBe('new/x.ts')
    expect(normalizeNumstatPath('plain/path.ts')).toBe('plain/path.ts')
  })
})

describe('变更清单合并与筛选', () => {
  const entries = parseGitStatusPorcelain(
    ' M src/b.ts\0?? src/a.md\0D  src/c.ts\0M  assets/l.png\0'
  )

  it('按路径排序并合入统计与指纹，已删除文件指纹为空', () => {
    const stats = parseGitNumstat('1\t1\tsrc/b.ts\n-\t-\tassets/l.png\n')
    stats.set('src/a.md', { additions: 3, deletions: 0, binary: false })
    const fingerprints = new Map([
      ['src/b.ts', 'hash-b'],
      ['src/a.md', 'hash-a'],
      ['assets/l.png', 'hash-l']
    ])
    const files = mergeGitChangeFiles(entries, stats, fingerprints)
    expect(files.map((file) => file.path)).toEqual([
      'assets/l.png',
      'src/a.md',
      'src/b.ts',
      'src/c.ts'
    ])
    expect(files[0]).toMatchObject({ status: 'modified', binary: true, hash: 'hash-l' })
    expect(files[1]).toMatchObject({ status: 'untracked', additions: 3 })
    expect(files[3]).toMatchObject({ status: 'deleted', hash: '', deletions: 0 })
  })

  it('selectChangedFiles 只留指纹变化的文件（含新增与删除）', () => {
    const previous = new Map([
      ['src/same.ts', 'h1'],
      ['src/edited.ts', 'h2'],
      ['src/removed.ts', 'h3']
    ])
    const files: GitChangeFile[] = [
      { path: 'src/same.ts', status: 'modified', additions: 1, deletions: 0, hash: 'h1' },
      { path: 'src/edited.ts', status: 'modified', additions: 2, deletions: 1, hash: 'h2-new' },
      { path: 'src/removed.ts', status: 'deleted', additions: 0, deletions: 9, hash: '' },
      { path: 'src/fresh.ts', status: 'untracked', additions: 5, deletions: 0, hash: 'h4' }
    ]
    expect(selectChangedFiles(previous, files).map((file) => file.path)).toEqual([
      'src/edited.ts',
      'src/removed.ts',
      'src/fresh.ts'
    ])
    // 首轮（无基线）时全部视为本轮改动
    expect(selectChangedFiles(new Map(), files)).toHaveLength(4)
    // 指纹快照可直接作为下一轮基线
    expect(fingerprintMap(files).get('src/fresh.ts')).toBe('h4')
  })
})

describe('统一 diff 解析', () => {
  it('文件头归为 meta（+++ 不被误判为新增行）', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@',
      ' context',
      '-removed',
      '+added',
      '+added2',
      ''
    ].join('\n')
    expect(parseUnifiedDiff(diff).map((line) => line.type)).toEqual([
      'meta',
      'meta',
      'meta',
      'meta',
      'hunk',
      'context',
      'del',
      'add',
      'add'
    ])
  })

  it('二进制与 rename 头同样归为 meta', () => {
    const types = parseUnifiedDiff(
      ['diff --git a/a b/a', 'similarity index 90%', 'rename from a', 'rename to b', 'Binary files a and b differ'].join(
        '\n'
      )
    ).map((line) => line.type)
    expect(types.every((type) => type === 'meta')).toBe(true)
  })
})

describe('未跟踪文件 diff 合成', () => {
  it('按新文件全文新增展示，行数与内容行一致', () => {
    const diff = buildUntrackedDiff('docs/新.md', 'line1\nline2\n')
    expect(diff).toContain('new file mode 100644')
    expect(diff).toContain('--- /dev/null')
    expect(diff).toContain('@@ -0,0 +1,2 @@')
    const lines = parseUnifiedDiff(diff)
    expect(lines.filter((line) => line.type === 'add')).toHaveLength(2)
    expect(lines.filter((line) => line.type === 'hunk')).toHaveLength(1)
  })
})

describe('路径越界校验', () => {
  it('只接受工程内相对路径', () => {
    expect(isSafeRelativePath('src/a.ts')).toBe(true)
    expect(isSafeRelativePath('docs/sub/文件.md')).toBe(true)
    expect(isSafeRelativePath('src\\a.ts')).toBe(true)
    expect(isSafeRelativePath('src/../secret')).toBe(false)
    expect(isSafeRelativePath('../out.ts')).toBe(false)
    expect(isSafeRelativePath('/etc/passwd')).toBe(false)
    expect(isSafeRelativePath('C:\\Windows\\x')).toBe(false)
    expect(isSafeRelativePath('   ')).toBe(false)
  })
})
