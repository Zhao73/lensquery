import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

if (process.platform !== 'darwin') {
  process.stdout.write('Skipping LensQuery Finder extension outside macOS.\n')
  process.exit(0)
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const result = spawnSync('/bin/bash', [join(scriptDirectory, 'build-finder-extension-macos.sh')], {
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
