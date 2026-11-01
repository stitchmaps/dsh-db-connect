import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
function load() {
  let plugin
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment',
    useState: init => [typeof init === 'function' ? init() : init, () => {}], useEffect: () => {}, useRef: current => ({ current }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  // Expose private components only in this isolated VM, without changing the artifact.
  const instrumented = source.replace('return {name:ID,inject:', 'return {test:{Editor:Editor,Runtime:Runtime,Panel:Panel,MetadataPage:MetadataPage,IndexesView:IndexesView,blank:blank,dictionaries:dictionaries},name:ID,inject:')
  vm.runInNewContext(instrumented, { window: { __ModuleLoader__: { load: module => { plugin = module.factory(name => { assert.equal(name, 'react'); return React }) } } }, AbortController })
  return plugin
}
function flatten(node, out = []) {
  if (node == null || node === false) return out
  if (Array.isArray(node)) { node.forEach(x => flatten(x, out)); return out }
  if (typeof node !== 'object') return out
  if (typeof node.type === 'function') return flatten(node.type(node.props), out)
  out.push(node)
  flatten(node.props?.children, out)
  return out
}

test('client registers stable main/sidebar identities with matching locale dictionaries', () => {
  const plugin = load(), slots = [], dictionaries = []
  const ctx = { effect: fn => fn(), locale: { register: (id, d) => { dictionaries.push([id, d]); return () => {} }, bind: () => key => plugin.test.dictionaries.en[key] }, slots: { inject: (_n, fn) => fn(), register: (spec, component) => { slots.push({ spec, component }); return () => {} } } }
  plugin.apply(ctx)
  assert.equal(plugin.name, 'dsh-db-connect')
  assert.equal(slots[0].spec.name, 'main')
  assert.equal(slots[0].spec.key, slots[1].spec.id)
  assert.equal(slots[1].spec.name, 'sidebar.panellist')
  assert.deepEqual(Object.keys(dictionaries[0][1].en).sort(), Object.keys(dictionaries[0][1].zh).sort())
  assert.equal(plugin.test.blank().agentEnabled, false)
})

test('all six connection forms keep password blank and require save before testing', () => {
  const plugin = load(), t = key => { assert.ok(plugin.test.dictionaries.zh[key], key); return plugin.test.dictionaries.zh[key] }
  for (const type of ['oracle', 'postgresql', 'mysql', 'mariadb', 'sqlserver', 'sqlite']) {
    const nodes = flatten(plugin.test.Editor({ t, profile: { type, name: 'Fixture', password: 'must-not-echo', hasPassword: true }, onDirty() {}, onSaved() {}, onDeleted() {} }))
    const passwords = nodes.filter(n => n.type === 'input' && n.props.type === 'password')
    assert.equal(passwords.length, type === 'sqlite' ? 0 : 1)
    for (const input of passwords) assert.equal(input.props.value, '')
    const checkbox = nodes.find(n => n.type === 'input' && n.props.type === 'checkbox')
    assert.equal(checkbox.props.checked, false)
    const testButton = nodes.find(n => n.type === 'button' && n.props.children.flat(Infinity).includes(t('test')))
    assert.equal(testButton.props.disabled, true)
  }
})

test('runtime form matches host timeout range and explains credential reset', () => {
  const plugin = load(), t = key => plugin.test.dictionaries.en[key]
  const nodes = flatten(plugin.test.Runtime({ t, settings: { pythonPath: '', timeoutSeconds: 30 }, onDirty() {}, onSettings() {} }))
  const number = nodes.find(n => n.type === 'input' && n.props.type === 'number')
  assert.equal(number.props.min, 5)
  assert.equal(number.props.max, 120)
  assert.match(t('settingsHint'), /clears saved passwords/)
  assert.match(source, /onSettings:function\(value\)\{setSettings\(value\);load\(\)\}/)
})

test('columns view mounts an indexes section and both renders are crash-free', () => {
  const plugin = load(), t = key => { assert.ok(plugin.test.dictionaries.en[key], key); return plugin.test.dictionaries.en[key] }
  const nodes = flatten(plugin.test.MetadataPage({ t, columns: true, query: { op: 'columns', id: 'x', schema: 'main', table: 'sample' } }))
  const headings = nodes.filter(n => n.type === 'h3').map(n => n.props.children.flat(Infinity).join(' '))
  // Columns heading "columns · sample" plus the nested IndexesView heading "Indexes & keys".
  assert.ok(headings.some(x => x === t('indexes')))
  assert.ok(headings.some(x => x.includes('sample')))
  const idx = flatten(plugin.test.IndexesView({ t, query: { op: 'indexes', id: 'x', schema: 'main', table: 'sample' } }))
  assert.ok(idx.some(n => n.type === 'h3' && n.props.children.flat(Infinity).join(' ') === t('indexes')))
})
