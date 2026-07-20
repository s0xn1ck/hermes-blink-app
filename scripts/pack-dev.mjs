import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const raw = process.env.HERMES_BLINK_API_ORIGIN
if (!raw) {
  console.error('Set HERMES_BLINK_API_ORIGIN, for example: HERMES_BLINK_API_ORIGIN=http://192.168.1.42:8642 npm run pack:dev')
  process.exit(1)
}

let url
try {
  url = new URL(raw)
} catch {
  console.error(`Invalid HERMES_BLINK_API_ORIGIN: ${raw}`)
  process.exit(1)
}

const origin = url.origin
const host = url.hostname.toLowerCase()
const localHttp = url.protocol === 'http:' && (
  host === 'localhost' ||
  host === '127.0.0.1' ||
  host.startsWith('10.') ||
  host.startsWith('192.168.') ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
)

if (url.protocol !== 'https:' && !localHttp) {
  console.error(`Dev origin must be https:// or local/LAN http://, got ${origin}`)
  process.exit(1)
}

const build = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_HERMES_BLINK_API_ORIGIN: origin,
    VITE_HERMES_BLINK_CHANNEL: 'dev',
  },
})
if (build.status !== 0) process.exit(build.status ?? 1)

const app = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'))
app.name = 'Hermes Blink Dev'
app.package_id = 'com.s0xn1ck.hermesblink.dev'
app.permissions = app.permissions.map((permission) => {
  if (permission.name !== 'network') return permission
  return {
    ...permission,
    desc: 'Development build: connects directly to one explicit Hermes API origin.',
    whitelist: [origin],
  }
})

await mkdir(new URL('../.tmp', import.meta.url), { recursive: true })
await writeFile(new URL('../.tmp/app.dev.generated.json', import.meta.url), `${JSON.stringify(app, null, 2)}\n`)
console.log(`Wrote .tmp/app.dev.generated.json with network whitelist: ${origin}`)

const pack = spawnSync('evenhub', ['pack', '.tmp/app.dev.generated.json', 'dist', '-o', 'hermes-blink-dev.ehpk'], {
  stdio: 'inherit',
  shell: false,
})
process.exit(pack.status ?? 1)
