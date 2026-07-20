export async function deriveDeviceBindingId(serial: string): Promise<string> {
  const normalized = serial.trim()
  if (!normalized) throw new Error('Glasses serial number is unavailable')
  const bytes = new TextEncoder().encode(`hermes-blink-device-v1:${normalized}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `g2_${hex.slice(0, 32)}`
}
