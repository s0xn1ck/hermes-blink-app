export function chunkForG2(text: string, maxChars = 420): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return ['']

  const chunks: string[] = []
  let remaining = clean

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1)
    const breakAt = Math.max(
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf(' '),
    )
    const idx = breakAt > maxChars * 0.5 ? breakAt + 1 : maxChars
    chunks.push(remaining.slice(0, idx).trim())
    remaining = remaining.slice(idx).trim()
  }

  if (remaining) chunks.push(remaining)
  return chunks
}

export function formatLensPage(title: string, body: string, page: number, total: number): string {
  const suffix = total > 1 ? `\n\n[${page + 1}/${total}] Tap next` : ''
  return `${title}\n\n${body}${suffix}`.slice(0, 1000)
}

export function tailForPhone(text: string, maxChars = 1_500): string {
  if (text.length <= maxChars) return text
  return `…\n${text.slice(-(maxChars - 2))}`
}
