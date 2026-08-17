(() => {
  if (window.__lensQueryPicker?.active) {
    window.__lensQueryPicker.stop()
    return
  }

  const contextApi = window.__lensQueryPageContext
  if (!contextApi) {
    showFailure('网页上下文采集器没有初始化，请刷新页面后重试。')
    return
  }

  const state = { active: true, highlighted: null, locked: null }
  document.documentElement.classList.add('lensquery-picking')
  const badge = document.createElement('div')
  badge.id = 'lensquery-picker-badge'
  badge.textContent = '❓ 点击网页内容 · Esc 取消'
  document.documentElement.appendChild(badge)

  function highlight(element) {
    if (state.highlighted === element) return
    state.highlighted?.classList.remove('lensquery-target')
    state.highlighted = element
    element?.classList.add('lensquery-target')
  }

  function onMove(event) {
    if (state.locked) return
    highlight(document.elementFromPoint(event.clientX, event.clientY))
  }

  function onKey(event) {
    if (event.key === 'Escape') stop()
  }

  async function onClick(event) {
    event.preventDefault()
    event.stopImmediatePropagation()
    const element = event.composedPath().find((item) => item instanceof Element)
    if (!element) return stop()
    if (state.locked !== element) {
      state.locked = element
      highlight(element)
      badge.textContent = '已高亮目标 · 再点一次自动分析'
      return
    }
    const selected = window.getSelection()?.toString().trim()
    const kind = selected
      ? 'selection'
      : element.closest('video, audio, .html5-video-player, [data-media-player]')
        ? 'video'
        : element.closest('img, picture') ? 'image' : 'object'
    const context = contextApi.buildContext(element, { kind })
    context.selectionMode = window.getSelection()?.toString().trim() ? 'selection' : 'object'
    context.selectedText = contextApi.textForScope(element, context.selectionMode)
    stop()
    const enriched = await contextApi.enrichContext(context)
    const response = await chrome.runtime.sendMessage({ type: 'lensquery-context', context: enriched })
    if (!response?.ok) showFailure(response?.error)
  }

  function stop() {
    state.active = false
    state.highlighted?.classList.remove('lensquery-target')
    state.locked = null
    badge.remove()
    document.documentElement.classList.remove('lensquery-picking')
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('keydown', onKey, true)
    delete window.__lensQueryPicker
  }

  function showFailure(message) {
    const notice = document.createElement('div')
    notice.id = 'lensquery-picker-error'
    notice.textContent = `What is it 连接失败：${message || '请先启动桌面应用并安装 Native Messaging Host。'}`
    document.documentElement.appendChild(notice)
    setTimeout(() => notice.remove(), 6000)
  }

  window.__lensQueryPicker = { active: true, stop }
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('click', onClick, true)
  window.addEventListener('keydown', onKey, true)
})()
