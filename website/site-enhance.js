/**
 * 站点增强脚本 —— 与具体页面解耦的通用交互。
 *
 * 目前提供：
 *  1. 代码块 / 提示词块的一键复制（pre、.prompt-block、[data-copy]）；
 *  2. 轻量的 toast 提示（复用页面已有的 .toast，没有则自建）；
 *  3. 文档页导读：面包屑、阅读时长、编辑 / 反馈入口、上一篇 / 下一篇、标题链接复制、警示提示块。
 *
 * 用法：<script src="site-enhance.js" defer></script>
 */
;(function () {
  'use strict'

  var isEn = (document.documentElement.lang || 'zh').toLowerCase().indexOf('en') === 0
  var TEXT = isEn
    ? { copy: 'Copy', copied: 'Copied', failed: 'Copy failed' }
    : { copy: '复制', copied: '已复制', failed: '复制失败' }

  var toastTimer = 0

  function getToast() {
    var el = document.querySelector('.toast')
    if (el) return el
    el = document.createElement('div')
    el.className = 'toast'
    el.setAttribute('role', 'status')
    document.body.appendChild(el)
    return el
  }

  function showToast(message) {
    var el = getToast()
    el.textContent = message
    el.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () {
      el.classList.remove('show')
    }, 1600)
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.top = '-1000px'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      var ok = false
      try {
        ok = document.execCommand('copy')
      } catch (e) {
        ok = false
      }
      document.body.removeChild(ta)
      ok ? resolve() : reject(new Error('execCommand failed'))
    })
  }

  /**
   * 为可复制块挂上按钮。
   * 元素可通过 data-copy 指定实际复制内容（用于想展示格式化文本但复制原始提示词的场景）。
   */
  function enhanceCopyBlocks() {
    var blocks = document.querySelectorAll('pre, .prompt-block, [data-copy]')
    Array.prototype.forEach.call(blocks, function (block) {
      if (block.querySelector(':scope > .copy-btn')) return
      if (block.classList.contains('copy-btn')) return

      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'copy-btn'
      btn.textContent = TEXT.copy
      btn.setAttribute('aria-label', TEXT.copy)
      btn.addEventListener('click', function (event) {
        event.stopPropagation()
        var payload = block.getAttribute('data-copy') || block.textContent || ''
        copyText(payload.replace(/\s+$/, '')).then(
          function () {
            btn.textContent = TEXT.copied
            btn.classList.add('is-done')
            setTimeout(function () {
              btn.textContent = TEXT.copy
              btn.classList.remove('is-done')
            }, 1400)
            showToast(TEXT.copied)
          },
          function () {
            showToast(TEXT.failed)
          }
        )
      })
      block.appendChild(btn)
    })
  }

  /** 外链统一补安全属性，避免遗漏 rel=noopener */
  function hardenExternalLinks() {
    var links = document.querySelectorAll('a[href^="http"]')
    Array.prototype.forEach.call(links, function (a) {
      if (a.host && a.host !== location.host) {
        if (!a.getAttribute('rel')) a.setAttribute('rel', 'noopener noreferrer')
        if (!a.getAttribute('target')) a.setAttribute('target', '_blank')
      }
    })
  }

  var REPO = 'https://github.com/Justin-sky/ai-art-engine'

  /** 文档阅读顺序，决定面包屑分组与上一篇 / 下一篇 */
  var DOCS = [
    ['quickstart', 'docs', '快速上手', 'Quickstart'],
    ['manual', 'manual', '概述与核心概念', 'Overview & core concepts'],
    ['manual-setup', 'manual', '工程与设置', 'Projects & settings'],
    ['manual-workspace', 'manual', '工作区与资产库', 'Workspace & asset library'],
    ['manual-workflow', 'manual', '一键工作流与节点图', 'One-Click Workflow & node graph'],
    ['manual-production', 'manual', '剧本、成片与导演台', 'Script, timeline & director stage'],
    ['manual-reference', 'manual', '参考与故障排查', 'Reference & troubleshooting'],
    ['guide-short-video', 'guides', '短剧教程', 'Short drama'],
    ['guide-video', 'guides', '视频教程', 'Video'],
    ['guide-comfyui', 'guides', 'ComfyUI 教程', 'ComfyUI'],
    ['guide-newapi', 'guides', 'NewAPI 教程', 'NewAPI'],
    ['guide-mcp', 'guides', 'MCP 接入', 'MCP setup'],
    ['guide-gameplay', 'guides', '可玩 HTML', 'Playable HTML'],
    ['developers', 'dev', '开发者文档', 'Developer docs']
  ]

  var DOC_TEXT = isEn
    ? {
        home: 'Home',
        groups: { docs: 'Docs', manual: 'Manual', guides: 'Guides', dev: 'Developers' },
        crumbs: 'Breadcrumb',
        read: function (n) {
          return n + ' min read'
        },
        edit: 'Edit this page on GitHub',
        editShort: 'Edit this page',
        issue: 'Report an issue',
        changelog: 'Changelog',
        missing: 'Something wrong or missing on this page?',
        prev: 'Previous',
        next: 'Next',
        pager: 'Document navigation',
        copyLink: 'Click to copy link to this section',
        linkCopied: 'Section link copied',
        onThisPage: 'On this page',
        tree: 'Documentation',
        treeGroups: ['Get started', 'Manual', 'Guides', 'Developers', 'Resources'],
        videos: 'Video tutorials',
        download: 'Download'
      }
    : {
        home: '首页',
        groups: { docs: '文档', manual: '使用手册', guides: '专题教程', dev: '开发者' },
        crumbs: '面包屑',
        read: function (n) {
          return '约 ' + n + ' 分钟阅读'
        },
        edit: '在 GitHub 上编辑此页',
        editShort: '编辑此页',
        issue: '提交问题',
        changelog: '更新日志',
        missing: '本页内容有误或缺失？',
        prev: '上一篇',
        next: '下一篇',
        pager: '文档导航',
        copyLink: '点击复制本节链接',
        linkCopied: '已复制本节链接',
        onThisPage: '本页目录',
        tree: '文档目录',
        treeGroups: ['开始使用', '使用手册', '专题教程', '开发者', '资源'],
        videos: 'B 站视频教程',
        download: '下载安装'
      }

  var SVG = {
    clock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    issue:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
    log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7"/></svg>'
  }

  function el(tag, attrs, html) {
    var node = document.createElement(tag)
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key])
    })
    if (html != null) node.innerHTML = html
    return node
  }

  function docHref(key) {
    return key + (isEn ? '.en' : '') + '.html'
  }

  function readingMinutes(root) {
    var text = root.textContent || ''
    var cjk = (text.match(/[\u3400-\u9fff]/g) || []).length
    var words = (text.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length
    return Math.max(1, Math.round(cjk / 450 + words / 230))
  }

  function buildDocTree(shell, currentKey) {
    var groupOf = { docs: 0, manual: 1, guides: 2, dev: 3 }
    var groups = [[], [], [], [], []]
    DOCS.forEach(function (doc) {
      groups[groupOf[doc[1]]].push(
        '<li><a href="' + docHref(doc[0]) + '"' + (doc[0] === currentKey ? ' aria-current="page"' : '') + '>' +
          doc[isEn ? 3 : 2] + '</a></li>'
      )
    })
    var ext = '<span class="ext" aria-hidden="true">↗</span>'
    groups[4].push(
      '<li><a href="index' + (isEn ? '.en' : '') + '.html#download">' + DOC_TEXT.download + '</a></li>',
      '<li><a href="' + REPO + '/blob/main/CHANGELOG.md">' + DOC_TEXT.changelog + ext + '</a></li>',
      '<li><a href="https://space.bilibili.com/3707036976024122">' + DOC_TEXT.videos + ext + '</a></li>'
    )
    var tree = el('nav', { class: 'doc-tree', 'aria-label': DOC_TEXT.tree })
    tree.innerHTML = groups
      .map(function (items, i) {
        return '<h2>' + DOC_TEXT.treeGroups[i] + '</h2><ul>' + items.join('') + '</ul>'
      })
      .join('')
    shell.insertBefore(tree, shell.firstChild)
    shell.classList.add('has-tree')

    // 右侧目录只保留本页锚点，跨页链接交给左侧文档树
    var toc = shell.querySelector('.toc')
    if (!toc) return
    var heading = toc.querySelector('h2')
    if (heading) heading.textContent = DOC_TEXT.onThisPage
    toc.setAttribute('aria-label', DOC_TEXT.onThisPage)
    Array.prototype.forEach.call(toc.querySelectorAll(':scope > p'), function (p) {
      p.classList.add('toc-ext')
    })
    var list = toc.querySelector('ol')
    if (!list) return
    var group = null
    var groupHasLocal = false
    var closeGroup = function () {
      if (group && !groupHasLocal) group.classList.add('toc-ext')
    }
    Array.prototype.forEach.call(list.children, function (li) {
      if (li.classList.contains('toc-group')) {
        closeGroup()
        group = li
        groupHasLocal = false
        return
      }
      var link = li.querySelector('a')
      if (link && (link.getAttribute('href') || '').charAt(0) !== '#') {
        li.classList.add('toc-ext')
      } else {
        groupHasLocal = true
      }
    })
    closeGroup()
  }

  function enhanceDocPage() {
    var article = document.querySelector('.manual-shell .manual')
    var hero = article && article.querySelector('.manual-hero')
    if (!hero) return
    var file = location.pathname.split('/').pop() || ''
    var key = file.replace(/(\.en)?\.html$/, '')
    var index = -1
    DOCS.forEach(function (doc, i) {
      if (doc[0] === key) index = i
    })
    if (index < 0) return
    var doc = DOCS[index]
    var title = doc[isEn ? 3 : 2]
    var sourceFile = key + (isEn ? '.en' : '') + '.html'
    var editUrl = REPO + '/blob/main/website/' + sourceFile
    var issueUrl = REPO + '/issues/new?title=' + encodeURIComponent('[docs] ' + sourceFile + ': ')

    buildDocTree(article.parentElement, key)

    var crumbs = el('nav', { class: 'doc-crumbs', 'aria-label': DOC_TEXT.crumbs })
    crumbs.innerHTML =
      '<a href="index' + (isEn ? '.en' : '') + '.html">' + DOC_TEXT.home + '</a>' +
      '<span class="sep" aria-hidden="true">/</span>' +
      '<span>' + DOC_TEXT.groups[doc[1]] + '</span>' +
      '<span class="sep" aria-hidden="true">/</span>' +
      '<span aria-current="page">' + title + '</span>'
    hero.insertBefore(crumbs, hero.firstChild)

    var meta = el('div', { class: 'doc-meta' })
    meta.innerHTML =
      '<span>' + SVG.clock + DOC_TEXT.read(readingMinutes(article)) + '</span>' +
      '<a href="' + editUrl + '">' + SVG.edit + DOC_TEXT.edit + '</a>' +
      '<a href="' + REPO + '/blob/main/CHANGELOG.md">' + SVG.log + DOC_TEXT.changelog + '</a>'
    hero.appendChild(meta)

    var pager = article.querySelector('.doc-pager')
    var actions = el('div', { class: 'doc-actions' })
    actions.innerHTML =
      '<span>' + DOC_TEXT.missing + '</span>' +
      '<nav><a href="' + editUrl + '">' + SVG.edit + DOC_TEXT.editShort + '</a>' +
      '<a href="' + issueUrl + '">' + SVG.issue + DOC_TEXT.issue + '</a></nav>'
    if (pager) {
      article.insertBefore(actions, pager)
    } else {
      article.appendChild(actions)
      pager = el('nav', { class: 'doc-pager', 'aria-label': DOC_TEXT.pager })
      var prev = DOCS[index - 1]
      var next = DOCS[index + 1]
      if (prev) {
        pager.appendChild(
          el(
            'a',
            { href: docHref(prev[0]) },
            '<span class="pager-dir">← ' + DOC_TEXT.prev + '</span><span class="pager-title">' + prev[isEn ? 3 : 2] + '</span>'
          )
        )
      }
      if (next) {
        pager.appendChild(
          el(
            'a',
            { href: docHref(next[0]) },
            '<span class="pager-dir">' + DOC_TEXT.next + ' →</span><span class="pager-title">' + next[isEn ? 3 : 2] + '</span>'
          )
        )
      }
      article.appendChild(pager)
    }

    // 标题点击复制本节链接（页面内联脚本已处理的会带 title，跳过）
    var headings = article.querySelectorAll('section[id] > h2, h3[id], h4[id]')
    Array.prototype.forEach.call(headings, function (heading) {
      if (heading.title) return
      var id = heading.id || heading.parentElement.id
      heading.title = DOC_TEXT.copyLink
      heading.addEventListener('click', function () {
        if (window.getSelection && String(window.getSelection())) return
        var url = location.origin + location.pathname + '#' + id
        copyText(url).then(
          function () {
            showToast(DOC_TEXT.linkCopied)
          },
          function () {
            showToast(url)
          }
        )
      })
    })

    // 以「注意 / 警告」开头的提示块切换为警示样式
    var warnRe = isEn ? /^\s*(warning|caution|important|note:\s*do not)/i : /^\s*(注意|警告|重要|切勿|务必)/
    Array.prototype.forEach.call(article.querySelectorAll('.tip'), function (tip) {
      if (warnRe.test(tip.textContent || '')) tip.classList.add('is-warn')
    })
  }

  function init() {
    enhanceCopyBlocks()
    enhanceDocPage()
    hardenExternalLinks()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  window.SiteToast = showToast
})()
