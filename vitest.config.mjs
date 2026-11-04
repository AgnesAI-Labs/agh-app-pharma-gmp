import { homedir } from 'node:os'
import { join } from 'node:path'

// The tests import @agnes/* workspace packages (and their dependencies). Resolve every bare import the plugin
// itself cannot see from a local open-source checkout (default ~/agnes-harness, override with AGNES_HARNESS).
const harness = process.env.AGNES_HARNESS ?? join(homedir(), 'agnes-harness')
// Importers inside these packages see the node_modules of the packages that depend on them.
const anchors = ['host', 'web-ui', 'web-client', 'sdk'].map((name) => join(harness, 'packages', name, 'index.ts'))

const fromHarness = {
  name: 'agh-harness-resolve',
  enforce: 'pre',
  async resolveId(id, importer, options) {
    if (!/^(?:@[\w-]+\/)?[\w-]/.test(id) || id.startsWith('node:') || importer?.startsWith(harness)) return null
    for (const anchor of anchors) {
      const resolved = await this.resolve(id, anchor, { ...options, skipSelf: true })
      if (resolved) return resolved
    }
    return null
  },
}

export default {
  plugins: [fromHarness],
  server: { fs: { allow: [harness, '.'] } },
  test: { include: ['test/**/*.test.ts'], maxWorkers: 1 },
}
