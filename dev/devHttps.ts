import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'

/**
 * Self-signed cert for LAN Vite. Chromium only exposes Gamepad API in a
 * secure context; http://10.x.x.x is not one. Slither works because it is HTTPS.
 */
export function lanHttpsOptions(): { key: Buffer; cert: Buffer } | undefined {
  if (!wantsLanHost()) return undefined
  const dir = resolve(process.cwd(), 'tmp')
  mkdirSync(dir, { recursive: true })
  const keyPath = resolve(dir, 'dev-key.pem')
  const certPath = resolve(dir, 'dev-cert.pem')
  const ips = lanIpv4()
  const names = [
    'DNS:localhost',
    'IP:127.0.0.1',
    ...ips.map((ip) => `IP:${ip}`),
  ]
  const stamp = resolve(dir, 'dev-cert.san')
  const sanLine = names.join(',')
  const previous = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : ''
  if (!existsSync(keyPath) || !existsSync(certPath) || previous !== sanLine) {
    const conf = resolve(dir, 'dev-openssl.cnf')
    writeOpenSslConfig(conf, names)
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-nodes',
        '-newkey',
        'rsa:2048',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '825',
        '-config',
        conf,
        '-extensions',
        'v3_req',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    writeFileSync(stamp, `${sanLine}\n`)
  }
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  }
}

function wantsLanHost(): boolean {
  const argv = process.argv
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--host' && argv[index + 1] === '0.0.0.0') return true
    if (arg === '--host=0.0.0.0') return true
    if (arg === '0.0.0.0') return true
  }
  return process.env.VITE_LAN_HTTPS === '1'
}

function lanIpv4(): string[] {
  const found = new Set<string>()
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      found.add(entry.address)
    }
  }
  return [...found]
}

function writeOpenSslConfig(path: string, names: string[]): void {
  const alt = names.join(',')
  writeFileSync(
    path,
    `[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req
x509_extensions = v3_req

[dn]
CN = localhost

[v3_req]
subjectAltName = ${alt}
`,
  )
}
