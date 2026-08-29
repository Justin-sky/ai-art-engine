/**
 * 站内全文搜索 —— 纯前端实现，不需要构建步骤，也不需要预先生成的索引文件。
 *
 * 工作方式：首次搜索时并行抓取站内页面，用 DOMParser 解析出每个 section 作为一个检索单元，
 * 结果缓存在内存中。因此内容更新后无需重新生成索引，始终保持与页面一致。
 *
 * 用法：在页面底部引入本文件即可（需配合 site.css）。
 *   <script src="site-search.js" defer></script>
 * 交互：Ctrl/Cmd + K 或 `/` 唤起；Esc 关闭。
 */
;(function () {
  'use strict'

  var html = document.documentElement
  var lang = (html.lang || 'zh').toLowerCase()
  var isEn = lang.indexOf('en') === 0

  var T = isEn
    ? {
        ariaLabel: 'Search documentation',
        placeholder: 'Search docs…',
        indexing: 'Indexing pages…',
        empty: 'No matching content',
        idle: 'Type to search across all pages',
        offline: 'Search is unavailable over file:// — serve the site over HTTP',
        hint: '↑↓ navigate · Enter open · Esc close',
        close: 'Close',
        open: 'Search (Ctrl+K)'
      }
    : {
        ariaLabel: '搜索文档',
        placeholder: '搜索文档…',
        indexing: '正在建立索引…',
        empty: '没有匹配的内容',
        idle: '输入关键词，跨页面检索',
        offline: 'file:// 下无法检索，请通过 HTTP 访问本站',
        hint: '↑↓ 选择 · Enter 打开 · Esc 关闭',
        close: '关闭',
        open: '搜索（Ctrl+K）'
      }

  var PAGES = isEn
    ? [
        { url: 'index.en.html', label: 'Home' },
        { url: 'quickstart.en.html', label: 'Quickstart' },
        { url: 'manual.en.html', label: 'Manual' },
        { url: 'guide-video.en.html', label: 'Video Guide' },
        { url: 'guide-short-video.en.html', label: 'Short Video' },
        { url: 'guide-comfyui.en.html', label: 'ComfyUI' }
      ]
    : [
        { url: 'index.html', label: '首页' },
        { url: 'quickstart.html', label: '快速上手' },
        { url: 'manual.html', label: '使用手册' },
        { url: 'guide-video.html', label: '视频生成指南' },
        { url: 'guide-short-video.html', label: '短视频教程' },
        { url: 'guide-comfyui.html', label: 'ComfyUI 教程' }
      ]

  var MAX_RESULTS = 24
  var SNIPPET_LEN = 110

  var root = null
  var input = null
  var listEl = null
  var statusEl = null
  var entries = []
  var indexState = 'idle' // idle | loading | ready | failed
  var current = []
  var cursor = -1

  /** 当前页面自身不必抓取，直接就地解析 */
  function collectFromDocument(page) {
    var doc = document
    return extractEntries(doc, page, true)
  }

  /**
   * 从文档中提取检索单元。
   * 优先按 section[id] 切分；没有 id 的页面退化为按 h2 切分，保证首页也能被检索。
   */
  function extractEntries(doc, page, isSelf) {
    var out = []
    var nodes = doc.querySelectorAll('article section[id]')
    if (nodes.length) {
      for (var i = 0; i < nodes.length; i++) out.push(buildEntry(nodes[i], page, isSelf))
      return out
    }

    var blocks = doc.querySelectorAll('main section, .manual section, section')
    if (blocks.length) {
      for (var j = 0; j < blocks.length; j++) out.push(buildEntry(blocks[j], page, isSelf))
      return out
    }

    var headings = doc.querySelectorAll('h2')
    if (!headings.length) return out
    for (var k = 0; k < headings.length; k++) {
      var h = headings[k]
      var parts = []
      var node = h.nextElementSibling
      while (node && node.tagName !== 'H2') {
        parts.push(node.textContent || '')
        node = node.nextElementSibling
      }
      out.push({
        page: page.label,
        url: page.url,
        hash: '',
        title: clean(h.textContent),
        body: clean(parts.join(' '))
      })
    }
    return out
  }

  function buildEntry(section, page, isSelf) {
    var heading = section.querySelector('h2, h3, h1')
    var clone = section.cloneNode(true)
    var noise = clone.querySelectorAll('script, style, nav, aside, .toc')
    for (var i = 0; i < noise.length; i++) noise[i].parentNode.removeChild(noise[i])
    return {
      page: page.label,
      url: page.url,
      hash: section.id || '',
      title: clean(heading ? heading.textContent : page.label),
      body: clean(clone.textContent || ''),
      isSelf: !!isSelf
    }
  }

  function clean(text) {
    return (text || '').replace(/\s+/g, ' ').trim()
  }

  function buildIndex() {
    if (indexState === 'ready' || indexState === 'loading') return Promise.resolve()
    indexState = 'loading'
    setStatus(T.indexing)

    var selfUrl = location.pathname.split('/').pop() || 'index.html'
    var jobs = PAGES.map(function (page) {
      if (page.url === selfUrl) {
        entries = entries.concat(collectFromDocument(page))
        return Promise.resolve()
      }
      return fetch(page.url)
        .then(function (res) {
          if (!res.ok) throw new Error(res.status)
          return res.text()
        })
        .then(function (text) {
          var doc = new DOMParser().parseFromString(text, 'text/html')
          entries = entries.concat(extractEntries(doc, page, false))
        })
        .catch(function () {
          /* 单页失败不影响整体检索 */
        })
    })

    return Promise.all(jobs).then(function () {
      indexState = entries.length ? 'ready' : 'failed'
      if (indexState === 'failed') setStatus(T.offline)
      else setStatus(T.idle)
    })
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  /** 截取命中位置附近的片段，并高亮关键词 */
  function snippet(body, terms) {
    var lower = body.toLowerCase()
    var hit = -1
    for (var i = 0; i < terms.length; i++) {
      var idx = lower.indexOf(terms[i])
      if (idx >= 0 && (hit === -1 || idx < hit)) hit = idx
    }
    var start = hit === -1 ? 0 : Math.max(0, hit - 40)
    var raw = body.slice(start, start + SNIPPET_LEN)
    var text = (start > 0 ? '…' : '') + raw + (start + SNIPPET_LEN < body.length ? '…' : '')
    return highlight(text, terms)
  }

  function highlight(text, terms) {
    var out = escapeHtml(text)
    terms.forEach(function (term) {
      if (!term) return
      var re = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi')
      out = out.replace(re, '<mark>$1</mark>')
    })
    return out
  }

  function runSearch(query) {
    var q = query.trim().toLowerCase()
    if (!q) {
      current = []
      listEl.innerHTML = ''
      setStatus(indexState === 'ready' ? T.idle : T.indexing)
      return
    }
    if (indexState !== 'ready') {
      setStatus(T.indexing)
      return
    }

    var terms = q.split(/\s+/).filter(Boolean)
    var scored = []
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]
      var title = e.title.toLowerCase()
      var body = e.body.toLowerCase()
      var score = 0
      var matched = true
      for (var j = 0; j < terms.length; j++) {
        var t = terms[j]
        var inTitle = title.indexOf(t) >= 0
        var inBody = body.indexOf(t) >= 0
        if (!inTitle && !inBody) {
          matched = false
          break
        }
        score += inTitle ? 12 : 0
        score += inBody ? 3 : 0
        if (inBody) {
          var count = body.split(t).length - 1
          score += Math.min(count, 5)
        }
      }
      if (matched) scored.push({ entry: e, score: score })
    }
    scored.sort(function (a, b) {
      return b.score - a.score
    })

    current = scored.slice(0, MAX_RESULTS)
    cursor = current.length ? 0 : -1
    render(terms)
    setStatus(current.length ? current.length + ' ' + (isEn ? 'results' : '条结果') : T.empty)
  }

  function render(terms) {
    if (!current.length) {
      listEl.innerHTML = ''
      return
    }
    listEl.innerHTML = current
      .map(function (item, i) {
        var e = item.entry
        var href = e.url + (e.hash ? '#' + e.hash : '')
        return (
          '<a class="sr-item' +
          (i === cursor ? ' is-active' : '') +
          '" href="' +
          href +
          '" role="option" aria-selected="' +
          (i === cursor) +
          '">' +
          '<span class="sr-item-page">' +
          escapeHtml(e.page) +
          '</span>' +
          '<span class="sr-item-title">' +
          highlight(e.title, terms) +
          '</span>' +
          '<span class="sr-item-snippet">' +
          snippet(e.body, terms) +
          '</span>' +
          '</a>'
        )
      })
      .join('')
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || ''
  }

  function moveCursor(delta) {
    if (!current.length) return
    cursor = (cursor + delta + current.length) % current.length
    var items = listEl.querySelectorAll('.sr-item')
    for (var i = 0; i < items.length; i++) {
      var active = i === cursor
      items[i].classList.toggle('is-active', active)
      items[i].setAttribute('aria-selected', String(active))
      if (active && items[i].scrollIntoView) items[i].scrollIntoView({ block: 'nearest' })
    }
  }

  function open() {
    if (!root) return
    root.hidden = false
    document.body.classList.add('sr-open')
    input.focus()
    input.select()
    buildIndex()
  }

  function close() {
    if (!root) return
    root.hidden = true
    document.body.classList.remove('sr-open')
  }

  function mount() {
    root = document.createElement('div')
    root.className = 'sr-root'
    root.hidden = true
    root.innerHTML =
      '<div class="sr-backdrop" data-sr-close></div>' +
      '<div class="sr-dialog" role="dialog" aria-modal="true" aria-label="' +
      T.ariaLabel +
      '">' +
      '<div class="sr-head">' +
      '<input class="sr-input" type="search" autocomplete="off" spellcheck="false" placeholder="' +
      T.placeholder +
      '" aria-label="' +
      T.ariaLabel +
      '" />' +
      '<button class="sr-close" type="button" data-sr-close aria-label="' +
      T.close +
      '">✕</button>' +
      '</div>' +
      '<div class="sr-status" role="status"></div>' +
      '<div class="sr-list" role="listbox" aria-label="' +
      T.ariaLabel +
      '"></div>' +
      '<div class="sr-foot">' +
      T.hint +
      '</div>' +
      '</div>'
    document.body.appendChild(root)

    input = root.querySelector('.sr-input')
    listEl = root.querySelector('.sr-list')
    statusEl = root.querySelector('.sr-status')

    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-sr-close]')) close()
    })

    input.addEventListener('input', function () {
      runSearch(input.value)
    })

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveCursor(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveCursor(-1)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        var active = listEl.querySelector('.sr-item.is-active')
        if (active) location.href = active.getAttribute('href')
      } else if (e.key === 'Escape') {
        close()
      }
    })

    listEl.addEventListener('click', function (e) {
      var item = e.target.closest('.sr-item')
      if (item) close()
    })

    mountTrigger()

    document.addEventListener('keydown', function (e) {
      var isCombo = (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')
      var isSlash = e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
      if (isCombo) {
        e.preventDefault()
        root.hidden ? open() : close()
      } else if (isSlash && root.hidden) {
        e.preventDefault()
        open()
      } else if (e.key === 'Escape' && !root.hidden) {
        close()
      }
    })
  }

  /** 在顶栏插入搜索按钮；找不到顶栏时仅保留快捷键入口 */
  function mountTrigger() {
    var header = document.querySelector('header.top, .top, header')
    if (!header) return
    var anchor = header.querySelector('.theme-toggle') || header.querySelector('.nav-lang')
    var btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'nav-search'
    btn.setAttribute('aria-label', T.open)
    btn.title = T.open
    btn.innerHTML = '<span aria-hidden="true">⌕</span>'
    btn.addEventListener('click', open)
    if (anchor && anchor.parentNode === header) header.insertBefore(btn, anchor)
    else header.appendChild(btn)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount)
  } else {
    mount()
  }
})()
