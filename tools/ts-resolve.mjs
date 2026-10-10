// Lets plain Node run the mod's TypeScript as it stands. Node strips the types
// by itself, but the files under hooks/ import each other without an
// extension (`./theme`), which Node will not resolve. This retries such an
// import with `.ts`. Register it with --import:
//   node --import ./tools/ts-resolve.mjs tools/manual-images.ts
import { registerHooks } from 'node:module'

const isRelative = specifier => specifier.startsWith('./') || specifier.startsWith('../')
const hasExtension = specifier => /\.[a-z]+$/i.test(specifier)

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!isRelative(specifier) || hasExtension(specifier) || error?.code !== 'ERR_MODULE_NOT_FOUND') throw error

      return nextResolve(`${specifier}.ts`, context)
    }
  },
})
