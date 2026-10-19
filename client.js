/* dsh-adaptive 的客户端半区：在会话视图里加一个「版本自适应」标签页。
   数据全部来自宿主 /dsh-adaptive/state；这里只负责展示与两个动作（重新扫描、复制 Markdown）。 */
window.__ModuleLoader__.load({
  id: 'dsh-adaptive',
  factory(require) {
    var React = require('react')
    var h = React.createElement

    var API = new URL('dsh-adaptive/', document.baseURI).href

    var CSS = [
      '.da-root{display:flex;flex-direction:column;gap:12px;font-size:13px;color:var(--dsw-alias-label-primary);min-height:0}',
      '.da-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.da-title{font-size:14px;font-weight:600}',
      '.da-sub{color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}',
      '.da-spacer{flex:1}',
      '.da-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}',
      '.da-btn:hover{border-color:var(--dsw-alias-border-l2)}',
      '.da-btn[disabled]{opacity:.55;cursor:default}',
      '.da-chips{display:flex;gap:8px;flex-wrap:wrap}',
      '.da-chip{border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 10px;font-size:12px;background:var(--dsw-alias-bg-layer-1)}',
      '.da-chip b{font-weight:600;margin-right:4px}',
      '.da-table{width:100%;border-collapse:collapse;font-size:12px}',
      '.da-table th{text-align:left;font-weight:600;color:var(--dsw-alias-label-secondary);padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}',
      '.da-table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}',
      '.da-name{font-weight:600;overflow-wrap:anywhere}',
      '.da-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;overflow-wrap:anywhere}',
      '.da-pill{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;border:1px solid var(--dsw-alias-border-l1);white-space:nowrap}',
      '.da-ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.da-bad{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.da-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.da-idle{color:var(--dsw-alias-state-idle-primary)}',
      '.da-detail{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:8px 10px;margin:2px 0 6px;display:flex;flex-direction:column;gap:6px}',
      '.da-detail ul{margin:0;padding-left:18px}',
      '.da-detail li{margin:2px 0}',
      '.da-section{border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px;display:flex;flex-direction:column;gap:8px}',
      '.da-section h4{margin:0;font-size:13px}',
      '.da-err{border:1px solid var(--dsw-alias-state-error-primary);border-radius:6px;padding:8px 10px;color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;overflow-wrap:anywhere}',
      '.da-note{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.5}',
      '.da-details summary{cursor:pointer;font-weight:600}',
      '.da-verline{display:flex;gap:8px;align-items:baseline}',
      '.da-ver{font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}',
      '.da-pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;margin:0}',
    ].join('')

    var STATUS = {
      ok: { text: '兼容', cls: 'da-ok' },
      unversioned: { text: '未声明版本约束', cls: 'da-idle' },
      incompatible: { text: '不兼容', cls: 'da-bad' },
      exempted: { text: '已授权例外', cls: 'da-warn' },
      invalid: { text: '清单无法判定', cls: 'da-bad' },
      unreadable: { text: '读不到', cls: 'da-warn' },
    }

    function statusPill(status) {
      var entry = STATUS[status] || { text: status, cls: 'da-idle' }
      return h('span', { className: 'da-pill ' + entry.cls }, entry.text)
    }

    function requirementText(plugin) {
      var entries = Object.keys(plugin.requirements || {})
      if (entries.length === 0) return h('span', { className: 'da-sub' }, '—')
      return h(
        'span',
        { className: 'da-mono' },
        entries.map(function (name) { return name + ' = ' + plugin.requirements[name] }).join('\n'),
      )
    }

    function PluginRow(plugin) {
      var details = []
      if (plugin.reasons && plugin.reasons.length > 0) {
        details.push(h('div', { key: 'reasons' }, h('ul', null, plugin.reasons.map(function (reason, index) {
          return h('li', { key: 'r' + String(index) }, reason)
        }))))
      }
      if (plugin.unmet && Object.keys(plugin.unmet).length > 0) {
        details.push(h('div', { key: 'unmet', className: 'da-note' }, '未满足：' + Object.keys(plugin.unmet).map(function (name) {
          return name + ' 需要 ' + String(plugin.unmet[name])
        }).join('；')))
      }
      if ((plugin.hints || []).length > 0) {
        details.push(h('div', { key: 'hints' }, h('ul', null, plugin.hints.map(function (hint, index) {
          var first = (hint.hits && hint.hits[0]) || {}
          return h('li', { key: 'h' + String(index) },
            h('div', null, h('b', null, hint.title), h('span', { className: 'da-sub' }, '（自 ' + hint.since + ' 起）')),
            h('div', { className: 'da-mono' }, String(first.path || '') + ':' + String(first.line || '')),
            h('div', { className: 'da-note' }, hint.advice),
          )
        }))))
      }
      if ((plugin.advisories || []).length > 0) {
        details.push(h('div', { key: 'adv' }, h('ul', null, plugin.advisories.map(function (advisory, index) {
          return h('li', { key: 'a' + String(index) }, advisory)
        }))))
      }
      return h('tr', { key: plugin.name },
        h('td', null, h('div', { className: 'da-name' }, plugin.name), h('div', { className: 'da-sub' }, plugin.version || '—')),
        h('td', null, requirementText(plugin)),
        h('td', null, statusPill(plugin.status)),
        h('td', null, details.length === 0 ? h('span', { className: 'da-sub' }, '—') : h('details', { className: 'da-details' },
          h('summary', null, '查看 ' + String(details.length) + ' 项'),
          h('div', { className: 'da-detail' }, details),
        )),
      )
    }

    function VersionSection(props) {
      var versions = props.versions || []
      if (versions.length === 0) return null
      return h('div', { className: 'da-section' },
        h('h4', null, '版本内容（官方 release notes 摘录）'),
        h('div', { className: 'da-note' }, '内置快照，离线可读；每条都能在对应 release 原文里找到出处。判定兼容性时只使用运行时版本与插件自身声明，不使用这张表。'),
        versions.map(function (entry) {
          var breaking = (entry.changes || []).filter(function (change) { return change.kind === 'breaking' }).length
          return h('details', { key: entry.version, className: 'da-details' },
            h('summary', null, h('span', { className: 'da-verline' },
              h('span', { className: 'da-ver' }, entry.version),
              h('span', { className: 'da-sub' }, entry.date + (breaking > 0 ? ' · 破坏性变更 ' + String(breaking) + ' 条' : '')),
            )),
            h('div', { className: 'da-detail' },
              h('ul', null, (entry.changes || []).map(function (change, index) {
                return h('li', { key: 'c' + String(index) },
                  h('span', { className: 'da-pill ' + (change.kind === 'breaking' ? 'da-bad' : 'da-ok') }, change.kind === 'breaking' ? '破坏性' : '功能'),
                  ' ',
                  h('span', null, change.text),
                )
              })),
            ),
          )
        }),
      )
    }

    function AdaptivePanel() {
      var state = React.useState({ loading: true, busy: false, error: null, data: null })
      var value = state[0]
      var setValue = state[1]

      function load(force) {
        setValue(function (previous) { return { loading: previous.data === null, busy: true, error: null, data: previous.data } })
        var url = API + (force ? 'scan' : 'state')
        var options = force ? { method: 'POST' } : { headers: { accept: 'application/json' } }
        fetch(url, options)
          .then(function (response) {
            return response.json().then(function (body) {
              if (!response.ok || body.ok !== true) {
                throw new Error((body && body.error && body.error.message) || ('HTTP ' + String(response.status)))
              }
              return body
            })
          })
          .then(function (body) { setValue({ loading: false, busy: false, error: null, data: body }) })
          .catch(function (error) { setValue(function (previous) { return { loading: false, busy: false, error: String((error && error.message) || error), data: previous.data } }) })
      }

      React.useEffect(function () { load(false) }, [])

      function copyMarkdown() {
        if (value.data && value.data.markdown && navigator.clipboard) {
          navigator.clipboard.writeText(value.data.markdown).catch(function () {})
        }
      }

      var data = value.data
      var summary = (data && data.summary) || {}
      var chips = data === null ? null : h('div', { className: 'da-chips' },
        h('span', { className: 'da-chip' }, h('b', null, '依赖'), String(summary.total || 0)),
        h('span', { className: 'da-chip' }, h('b', null, '兼容'), String(summary.ok || 0)),
        h('span', { className: 'da-chip' }, h('b', null, '未声明'), String(summary.unversioned || 0)),
        h('span', { className: 'da-chip' }, h('b', null, '不兼容'), String(summary.incompatible || 0)),
        h('span', { className: 'da-chip' }, h('b', null, '例外'), String(summary.exempted || 0)),
        h('span', { className: 'da-chip' }, h('b', null, '迁移提示'), String(summary.hints || 0)),
      )

      var body
      if (value.loading && data === null) {
        body = h('div', { className: 'da-note' }, '正在扫描当前 Profile…')
      } else if (data === null) {
        body = h('div', { className: 'da-err' }, value.error || '读不到状态')
      } else {
        body = h(React.Fragment, null,
          h('table', { className: 'da-table' },
            h('thead', null, h('tr', null,
              h('th', null, '插件'),
              h('th', null, '声明'),
              h('th', null, '状态'),
              h('th', null, '说明'),
            )),
            h('tbody', null, (data.plugins || []).map(PluginRow)),
          ),
          h(VersionSection, { versions: data.versions }),
          h('div', { className: 'da-note' },
            '兼容判定复刻 DSH 自己的规则（engines.dsh 优先，否则检查 @deepseek-ai/dsh* peer 范围；预发布参与比较；例外按精确 name@version 匹配运行时版本）。迁移提示是 release notes 规则的启发式静态扫描，命中不等于一定坏，没命中也不等于一定好。本页只读。',
          ),
          data.self ? h('div', { className: 'da-note' },
            '插件自检：' + (data.self.toolRegistered === true ? 'agent 工具已注册' : data.self.toolRegistered === false ? 'agent 工具未注册（宿主没有 tools 服务？）' : 'agent 工具状态未知') +
            ' · 本页数据来自 /dsh-adaptive/state',
          ) : null,
        )
      }

      return h('div', { className: 'da-root' },
        h('div', { className: 'da-head' },
          h('div', { className: 'da-title' }, '版本自适应'),
          data === null ? null : h('span', { className: 'da-pill da-idle' }, '运行时 ' + String(data.runtimeVersion || '未识别')),
          h('div', { className: 'da-spacer' }),
          h('button', { className: 'da-btn', type: 'button', disabled: value.busy, onClick: function () { load(true) } }, value.busy ? '扫描中…' : '重新扫描'),
          h('button', { className: 'da-btn', type: 'button', disabled: !(data && data.markdown), onClick: copyMarkdown }, '复制 Markdown'),
        ),
        data === null ? null : h('div', { className: 'da-sub' },
          'Profile：' + String(data.profileDir || '') +
          (data.profileDirSource ? '（' + String(data.profileDirSource) + '）' : '') +
          ' · 生成于 ' + String(data.generatedAt || '') +
          (data.runtimeVersionSource ? ' · 版本来源：' + String(data.runtimeVersionSource) : ''),
        ),
        value.error ? h('div', { className: 'da-err' }, value.error) : null,
        chips,
        body,
      )
    }

    function apply(ctx) {
      ctx.effect(function () {
        var style = document.createElement('style')
        style.dataset.plugin = 'dsh-adaptive'
        style.textContent = CSS
        document.head.appendChild(style)
        return function () { style.remove() }
      })

      // 面板可丢弃：slot 契约变化时少一个 Tab，不影响宿主与工具。
      ctx.slots.inject('conversation.view', function () {
        var dispose
        try {
          dispose = ctx.slots.register(
            { name: 'conversation.view', id: 'adaptive', order: 55, label: '版本自适应' },
            AdaptivePanel,
          )
        } catch (error) {
          dispose = undefined
          if (typeof console !== 'undefined' && console.warn) console.warn('[dsh-adaptive] 注册「版本自适应」视图失败；宿主工具仍然可用', error)
        }
        return typeof dispose === 'function' ? dispose : function () {}
      })
    }

    return { inject: ['slots'], apply: apply }
  },
})
