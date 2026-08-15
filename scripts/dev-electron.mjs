import { spawn } from 'node:child_process'
import process from 'node:process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const electronCommand = process.platform === 'win32'
  ? 'node_modules\\.bin\\electron.cmd'
  : 'node_modules/.bin/electron'

const vite = spawn(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '1420', '--strictPort'], {
  stdio: 'inherit',
  env: process.env,
})

let electron
let stopping = false

async function waitForVite() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:1420')
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('Vite did not start on port 1420.')
}

function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  electron?.kill('SIGTERM')
  vite.kill('SIGTERM')
  process.exitCode = exitCode
}

vite.on('exit', (code) => {
  if (!stopping) stop(code ?? 1)
})

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

try {
  await waitForVite()
  electron = spawn(electronCommand, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, LENSQUERY_DEV_URL: 'http://127.0.0.1:1420' },
  })
  electron.on('exit', (code) => stop(code ?? 0))
} catch (error) {
  console.error(error)
  stop(1)
}
