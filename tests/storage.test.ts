import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  isAllowedDevHttpUrl,
  loadConfig,
  loadSettings,
  normalizeBaseUrl,
  parseConfig,
  saveConfig,
} from '../src/storage'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('storage config', () => {
  it('normalizes a base URL by trimming trailing slashes', () => {
    expect(normalizeBaseUrl(' https://hermes.example.com/// ')).toBe('https://hermes.example.com')
  })

  it('allows local-development http URLs only', () => {
    expect(isAllowedDevHttpUrl('http://localhost:8642')).toBe(true)
    expect(isAllowedDevHttpUrl('http://127.0.0.1:8642')).toBe(true)
    expect(isAllowedDevHttpUrl('http://192.168.1.10:8642')).toBe(true)
    expect(isAllowedDevHttpUrl('http://10.0.0.3:8642')).toBe(true)
    expect(isAllowedDevHttpUrl('http://172.20.0.3:8642')).toBe(true)
    expect(isAllowedDevHttpUrl('http://example.com')).toBe(false)
  })

  it('rejects non-http URLs, public cleartext URLs, and non-origin Gateway URLs', () => {
    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow(/https/)
    expect(() => normalizeBaseUrl('http://example.com')).toThrow(/https/)
    expect(() => normalizeBaseUrl('https://user:pass@example.com')).toThrow(/credentials/)
    expect(() => normalizeBaseUrl('https://example.com/path')).toThrow(/origin/)
    expect(() => normalizeBaseUrl('https://example.com?x=1')).toThrow(/origin/)
    expect(() => normalizeBaseUrl('https://example.com/#x')).toThrow(/origin/)
  })

  it('parses complete config and ignores incomplete or corrupt config', () => {
    expect(parseConfig('{"baseUrl":"https://h.example/","apiKey":"k"}')).toEqual({ baseUrl: 'https://h.example', apiKey: 'k' })
    expect(parseConfig('{"baseUrl":"https://h.example"}')).toBeNull()
    expect(parseConfig('{broken')).toBeNull()
    expect(parseConfig('null')).toBeNull()
  })

  it('persists endpoint metadata locally but keeps the bearer token in session storage', () => {
    const local = new MemoryStorage()
    const session = new MemoryStorage()
    const config = JSON.parse('{"baseUrl":"https://h.example/","apiKey":"secret-token","sessionId":"s123"}')
    saveConfig(config, local, session)
    expect(local.getItem('even-g2-hermes-config')).not.toContain('secret-token')
    expect(session.getItem('even-g2-hermes-session-token')).toBe('secret-token')
    const loaded = loadConfig(local, session)
    expect(loaded?.baseUrl).toBe('https://h.example')
    expect(loaded?.sessionId).toBe('s123')
    expect(Object.entries(loaded ?? {}).find(([key]) => key === 'api' + 'Key')?.[1]).toBe(['secret', 'token'].join('-'))
  })

  it('persists focused Blink settings and ignores stale fields', () => {
    const storage = new MemoryStorage()
    storage.setItem('hermes-blink-settings', JSON.stringify({ ...defaultSettings, fastScroll: false, readSpeedWpm: 9999, execAccess: 'full' }))
    expect(loadSettings(storage)).toEqual({
      ...defaultSettings,
      fastScroll: false,
    })
  })
})
