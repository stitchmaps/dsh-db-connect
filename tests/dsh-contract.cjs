// Run with Electron in Node mode and DSH_APP_ROOT pointing to its app.asar.
// This reads packaged APIs; it does not load or change a live profile.
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
;(async () => {
  const root = process.env.DSH_APP_ROOT
  if (!root) throw new Error('Set DSH_APP_ROOT to the installed app.asar path.')
  const tools = await import(pathToFileURL(path.join(root, 'node_modules/@deepseek-ai/dsh-tools/lib/index.js')).href)
  const plugin = await import(pathToFileURL(path.resolve(__dirname, '../lib/index.js')).href)
  const definitions = plugin.definitions(tools.defineTool, { action: async () => ({ connections: [] }) })
  assert.equal(definitions.length, 2)
  for (const definition of definitions) {
    assert.equal(typeof definition.execute, 'function')
    console.log('Validated actual DSH defineTool:', definition.name)
  }
  const result = await definitions[0].execute({}, { signal: new AbortController().signal })
  assert.ok(result.ok)
})().catch(error => { console.error(error); process.exitCode = 1 })
