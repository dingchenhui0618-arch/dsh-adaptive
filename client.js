/* dsh-adaptive 的客户端半区：在会话视图里加一个「版本自适应」标签页。
   数据全部来自宿主 /dsh-adaptive/state；这里只负责展示与两个动作（重新扫描、复制 Markdown）。 */
window.__ModuleLoader__.load({
  id: 'dsh-adaptive',
  factory(require) {
    var React = require('react')
    var h = React.createElement

    var API = new URL('dsh-adaptive/', document.baseURI).href
    var MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'

    var CSS = [
      '.da-root{display:flex;flex-direction:column;gap:18px;font-size:13px;color:var(--dsw-alias-label-primary);padding:10px 16px 160px;min-width:0;line-height:1.5}',
      '.da-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.da-title{font-size:14px;font-weight:600;letter-spacing:.01em}',
      '.da-actions{display:flex;gap:8px;margin-left:auto}',
      '.da-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 10px;font-size:12px;line-height:1.4;cursor:pointer;transition:border-color .12s ease}',
      '.da-btn:hover{border-color:var(--dsw-alias-border-l2)}',
      '.da-btn[disabled]{opacity:.5;cursor:default}',
      '.da-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 28px;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.6}',
      '.da-meta-row{display:flex;gap:8px;min-width:0}',
      '.da-meta-key{flex:0 0 auto;opacity:.72}',
      '.da-meta-val{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:' + MONO + ';font-size:11px}',
      '.da-stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}',
      '.da-stat{display:flex;flex-direction:column;gap:3px;padding:11px 16px;border-left:1px solid var(--dsw-alias-border-l1)}',
      '.da-stat:first-child{border-left:0}',
      '.da-stat-label{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.da-stat-value{font-size:19px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums}',
      '.da-stat-value.da-ok{color:var(--dsw-alias-state-success-primary)}',
      '.da-stat-value.da-bad{color:var(--dsw-alias-state-error-primary)}',
      '.da-stat-value.da-warn{color:var(--dsw-alias-state-warn-primary)}',
      '.da-main{display:grid;grid-template-columns:minmax(0,1fr) 372px;gap:32px;align-items:start}',
      '.da-col-main{min-width:0;display:flex;flex-direction:column;gap:12px}',
      '.da-col-side{min-width:0;display:flex;flex-direction:column;gap:20px}',
      '.da-list-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}',
      '.da-list-head h4{margin:0;font-size:12.5px;font-weight:600;letter-spacing:.01em}',
      '.da-legend{display:flex;align-items:center;gap:14px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:auto}',
      '.da-legend-item{display:inline-flex;align-items:center;gap:6px}',
      '.da-legend-item.da-ok{color:var(--dsw-alias-state-success-primary)}',
      '.da-legend-item.da-bad{color:var(--dsw-alias-state-error-primary)}',
      '.da-legend-item.da-idle{color:var(--dsw-alias-label-secondary)}',
      '.da-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}',
      '.da-table th{text-align:left;font-weight:600;font-size:10.5px;color:var(--dsw-alias-label-secondary);letter-spacing:.04em;padding:0 10px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}',
      '.da-table td{padding:10px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top;min-width:0}',
      '.da-table tbody tr:hover td{background:var(--dsw-alias-bg-layer-1)}',
      '.da-name{font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.da-name-ver{font-family:' + MONO + ';font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:3px;opacity:.85}',
      '.da-req{font-family:' + MONO + ';font-size:11px;line-height:1.65;color:var(--dsw-alias-label-secondary);white-space:pre-line;overflow-wrap:anywhere;display:block}',
      '.da-req-inline{margin-top:5px;font-size:10.5px;opacity:.9}',
      '.da-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap}',
      '.da-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto}',
      '.da-status.da-ok{color:var(--dsw-alias-state-success-primary)}',
      '.da-status.da-bad{color:var(--dsw-alias-state-error-primary)}',
      '.da-status.da-warn{color:var(--dsw-alias-state-warn-primary)}',
      '.da-status.da-idle{color:var(--dsw-alias-label-secondary)}',
      '.da-details summary{cursor:pointer;font-size:11.5px;color:var(--dsw-alias-label-secondary);list-style:none;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}',
      '.da-details summary::-webkit-details-marker{display:none}',
      '.da-details summary:before{content:"▸";font-size:10px;opacity:.7}',
      '.da-details[open] summary:before{content:"▾"}',
      '.da-details summary:hover{color:var(--dsw-alias-label-primary)}',
      '.da-toggle{border:0;background:transparent;padding:0;font:inherit;font-size:11.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;white-space:nowrap;line-height:1.5}',
      '.da-toggle:hover{color:var(--dsw-alias-label-primary)}',
      '.da-detail-row:hover td{background:transparent}',
      '.da-detail-cell{padding:0 10px 12px}',
      '.da-detail-cell .da-detail{margin:0}',
      '.da-detail{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:10px 12px;margin:8px 0 2px;display:flex;flex-direction:column;gap:8px;white-space:normal}',
      '.da-detail ul{margin:0;padding-left:18px}',
      '.da-detail li{margin:3px 0;line-height:1.6}',
      '.da-section{display:flex;flex-direction:column;gap:10px;min-width:0}',
      '.da-col-side > .da-section + .da-section{border-top:1px solid var(--dsw-alias-border-l1);padding-top:16px}',
      '.da-section h4{margin:0;font-size:12.5px;font-weight:600;letter-spacing:.01em}',
      '.da-ver-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:12px}',
      '.da-ver{font-family:' + MONO + ';font-weight:600;font-size:12px}',
      '.da-note{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.7;max-width:74ch}',
      '.da-err{border:1px solid var(--dsw-alias-state-error-primary);border-radius:6px;padding:10px 12px;color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}',
      '.da-pill{display:inline-block;border-radius:999px;padding:1px 8px;font-size:10.5px;border:1px solid var(--dsw-alias-border-l1);white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.da-pill.da-ok{color:var(--dsw-alias-state-success-primary);border-color:currentColor}',
      '.da-pill.da-bad{color:var(--dsw-alias-state-error-primary);border-color:currentColor}',
      '.da-pill.da-warn{color:var(--dsw-alias-state-warn-primary);border-color:currentColor}',
      '.da-runtime{border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 9px;font-size:11px;color:var(--dsw-alias-label-secondary);font-family:' + MONO + '}',
      '.da-runtime span{color:var(--dsw-alias-label-secondary);opacity:.7;font-family:inherit}',
      '@media (max-width:1100px){.da-main{grid-template-columns:minmax(0,1fr)}.da-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.da-stat:nth-child(4){border-left:0}.da-meta{grid-template-columns:minmax(0,1fr)}}',
    ].join('')

    var STATUS = {
      ok: { text: '兼容', cls: 'da-ok' },
      unversioned: { text: '未声明', cls: 'da-idle' },
      incompatible: { text: '不兼容', cls: 'da-bad' },
      exempted: { text: '已授权例外', cls: 'da-warn' },
      invalid: { text: '清单无法判定', cls: 'da-bad' },
      unreadable: { text: '读不到', cls: 'da-warn' },
    }

    function statusLabel(status) {
      var entry = STATUS[status] || { text: status, cls: 'da-idle' }
      return h('span', { className: 'da-status ' + entry.cls }, h('span', { className: 'da-dot' }), entry.text)
    }

    function requirementText(plugin) {
      var entries = Object.keys(plugin.requirements || {})
      if (entries.length === 0) return null
      return entries.map(function (name) { return name + ' → ' + plugin.requirements[name] }).join('\n')
    }

    function requirementSummary(plugin) {
      var entries = Object.keys(plugin.requirements || {})
      if (entries.length === 0) return null
      var lines = entries.map(function (name) { return name + ' → ' + plugin.requirements[name] })
      if (lines.length <= 2) return lines.join('\n')
      return lines.slice(0, 2).join('\n') + '\n… 共 ' + String(lines.length) + ' 条约束（悬停看全部）'
    }

    function localTime(iso) {
      if (!iso) return '—'
      var date = new Date(iso)
      if (isNaN(date.getTime())) return String(iso)
      var pad = function (value) { return String(value).padStart(2, '0') }
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
        ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
    }

    function PluginRow(plugin, expanded, onToggle) {
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
            h('div', null, h('b', null, hint.title), h('span', { className: 'da-note' }, '（自 ' + hint.since + ' 起）')),
            h('div', { className: 'da-req' }, String(first.path || '') + ':' + String(first.line || '')),
            h('div', { className: 'da-note' }, hint.advice),
          )
        }))))
      }
      if ((plugin.advisories || []).length > 0) {
        details.push(h('div', { key: 'adv' }, h('ul', null, plugin.advisories.map(function (advisory, index) {
          return h('li', { key: 'a' + String(index) }, advisory)
        }))))
      }
      var requirement = requirementSummary(plugin)
      var requirementTitle = requirementText(plugin)
      var row = h('tr', null,
        h('td', null,
          h('div', { className: 'da-name', title: plugin.name }, plugin.name),
          h('div', { className: 'da-name-ver' }, plugin.version || '—'),
          requirement ? h('div', { className: 'da-req da-req-inline', title: requirementTitle || '' }, requirement) : null,
        ),
        h('td', null, statusLabel(plugin.status)),
        h('td', null, details.length === 0
          ? h('span', { className: 'da-req', style: { opacity: 0.35 } }, '—')
          : h('button', {
            className: 'da-toggle',
            type: 'button',
            'aria-expanded': expanded ? 'true' : 'false',
            onClick: onToggle,
          }, (expanded ? '▾ ' : '▸ ') + '查看 ' + String(details.length) + ' 项')),
      )
      if (!expanded || details.length === 0) return row
      return h(React.Fragment, { key: plugin.name },
        row,
        h('tr', { className: 'da-detail-row' },
          h('td', { colSpan: 3, className: 'da-detail-cell' }, h('div', { className: 'da-detail' }, details)),
        ),
      )
    }

    function VersionSection(props) {
      var versions = props.versions || []
      if (versions.length === 0) return null
      return h('div', { className: 'da-section' },
        h('h4', null, '版本内容'),
        h('div', { className: 'da-note', style: { marginTop: -2 } }, '官方 release notes 摘录，离线可读。判定兼容性时只使用运行时版本与插件自身声明，不使用这张表。'),
        versions.map(function (entry) {
          var breaking = (entry.changes || []).filter(function (change) { return change.kind === 'breaking' }).length
          return h('details', { key: entry.version, className: 'da-details' },
            h('summary', null, h('span', { className: 'da-ver-row' },
              h('span', { className: 'da-ver' }, entry.version),
              h('span', { className: 'da-note', style: { margin: 0 } }, entry.date + (breaking > 0 ? ' · 破坏性 ' + String(breaking) + ' 条' : '')),
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

    function statCell(label, value, tone) {
      return h('div', { className: 'da-stat' },
        h('span', { className: 'da-stat-label' }, label),
        h('span', { className: 'da-stat-value' + (tone ? ' ' + tone : '') }, String(value)),
      )
    }

    function legendItem(cls, text) {
      return h('span', { className: 'da-legend-item ' + cls }, h('span', { className: 'da-dot' }), text)
    }

    function AdaptivePanel() {
      var state = React.useState({ loading: true, busy: false, error: null, data: null })
      var value = state[0]
      var setValue = state[1]
      var openState = React.useState({})
      var openRows = openState[0]
      var setOpenRows = openState[1]

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
      var stats = data === null ? null : h('div', { className: 'da-stats' },
        statCell('依赖', summary.total || 0),
        statCell('兼容', summary.ok || 0, summary.ok > 0 ? 'da-ok' : ''),
        statCell('未声明', summary.unversioned || 0, summary.unversioned > 0 ? 'da-warn' : ''),
        statCell('不兼容', summary.incompatible || 0, summary.incompatible > 0 ? 'da-bad' : ''),
        statCell('例外', summary.exempted || 0),
        statCell('迁移提示', summary.hints || 0, summary.hints > 0 ? 'da-warn' : ''),
      )

      var body
      if (value.loading && data === null) {
        body = h('div', { className: 'da-note' }, '正在扫描当前 Profile…')
      } else if (data === null) {
        body = h('div', { className: 'da-err' }, value.error || '读不到状态')
      } else {
        body = h('div', { className: 'da-main' },
          h('div', { className: 'da-col-main' },
            h('div', { className: 'da-list-head' },
              h('h4', null, '已安装依赖 ' + String(summary.total || 0)),
              h('div', { className: 'da-legend' },
                legendItem('da-ok', '兼容'),
                legendItem('da-idle', '未声明'),
                legendItem('da-bad', '不兼容'),
              ),
            ),
            h('table', { className: 'da-table' },
              h('colgroup', null,
                h('col', { style: { width: '60%' } }),
                h('col', { style: { width: '17%' } }),
                h('col', { style: { width: '23%' } }),
              ),
              h('thead', null, h('tr', null,
                h('th', null, '插件与版本声明'),
                h('th', null, '状态'),
                h('th', null, '说明'),
              )),
              h('tbody', null, (data.plugins || []).map(function (plugin) {
                return PluginRow(plugin, openRows[plugin.name] === true, function () {
                  setOpenRows(function (previous) {
                    var next = {}
                    Object.keys(previous).forEach(function (name) { next[name] = previous[name] })
                    next[plugin.name] = !next[plugin.name]
                    return next
                  })
                })
              })),
            ),
          ),
          h('div', { className: 'da-col-side' },
            h(VersionSection, { versions: data.versions }),
            h('div', { className: 'da-section' },
              h('h4', null, '判定规则'),
              h('div', { className: 'da-note' },
                '复刻 DSH 自己的规则：engines.dsh 优先；没有就要求所有 @deepseek-ai/dsh* peer 都满足。预发布参与比较；例外按精确 name@version 匹配运行时版本。',
              ),
            ),
            h('div', { className: 'da-section' },
              h('h4', null, '提示怎么来的'),
              h('div', { className: 'da-note' },
                '迁移提示是对插件源码的启发式静态扫描（release notes 规则），命中不等于一定坏，没命中也不等于一定好。本页只读，不修改任何插件。',
              ),
            ),
            data.self ? h('div', { className: 'da-section' },
              h('h4', null, '插件自检'),
              h('div', { className: 'da-note' },
                (data.self.toolRegistered === true ? 'agent 工具已注册' : data.self.toolRegistered === false ? 'agent 工具未注册（宿主没有 tools 服务？）' : 'agent 工具状态未知') +
                ' · 数据来自 /dsh-adaptive/state',
              ),
            ) : null,
          ),
        )
      }

      return h('div', { className: 'da-root' },
        h('div', { className: 'da-head' },
          h('div', { className: 'da-title' }, '版本自适应'),
          data === null ? null : h('span', { className: 'da-runtime' }, h('span', null, '运行时 '), data.runtimeVersion || '未识别'),
          h('div', { className: 'da-actions' },
            h('button', { className: 'da-btn', type: 'button', disabled: value.busy, onClick: function () { load(true) } }, value.busy ? '扫描中…' : '重新扫描'),
            h('button', { className: 'da-btn', type: 'button', disabled: !(data && data.markdown), onClick: copyMarkdown }, '复制 Markdown'),
          ),
        ),
        data === null ? null : h('div', { className: 'da-meta' },
          h('div', { className: 'da-meta-row' }, h('span', { className: 'da-meta-key' }, 'Profile'), h('span', { className: 'da-meta-val', title: String(data.profileDir || '') }, String(data.profileDir || '') + (data.profileDirSource ? ' · ' + String(data.profileDirSource) : ''))),
          h('div', { className: 'da-meta-row' }, h('span', { className: 'da-meta-key' }, '版本来源'), h('span', { className: 'da-meta-val', title: String(data.runtimeVersionSource || '') }, String(data.runtimeVersionSource || '未识别'))),
          h('div', { className: 'da-meta-row' }, h('span', { className: 'da-meta-key' }, '生成于'), h('span', { className: 'da-meta-val' }, localTime(data.generatedAt))),
          h('div', { className: 'da-meta-row' }, h('span', { className: 'da-meta-key' }, '状态'), h('span', { className: 'da-meta-val' }, value.busy ? '正在重新扫描…' : '已就绪，只读')),
        ),
        value.error ? h('div', { className: 'da-err' }, value.error) : null,
        stats,
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
