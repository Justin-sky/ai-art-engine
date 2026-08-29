/**
 * 站点增强脚本 —— 与具体页面解耦的通用交互。
 *
 * 目前提供：
 *  1. 代码块 / 提示词块的一键复制（pre、.prompt-block、[data-copy]）；
 *  2. 轻量的 toast 提示（复用页面已有的 .toast，没有则自建）。
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

  function init() {
    enhanceCopyBlocks()
    hardenExternalLinks()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  window.SiteToast = showToast
})()
