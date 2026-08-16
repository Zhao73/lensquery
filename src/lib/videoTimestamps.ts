type MarkdownNode = {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

export interface VideoTimestampOptions {
  durationSeconds?: number
}

const TIMESTAMP_PATTERN = /(?<![\d:])(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)(?![\d:])/g
const CLOCK_CONTEXT_PATTERN = /(?:上午|下午|晚上|凌晨|时间|\b(?:at|around))\s*$/i

export function parseVideoTimestamp(value: string): number | undefined {
  const match = /^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/.exec(value.trim())
  if (!match) return undefined
  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  return (hours * 60 * 60) + (minutes * 60) + seconds
}

export function videoTimestampHref(seconds: number): string {
  return `#video-t=${Math.max(0, Math.floor(seconds))}`
}

export function parseVideoTimestampHref(href?: string): number | undefined {
  const match = /^#video-t=(\d+(?:\.\d+)?)$/.exec(href ?? '')
  if (!match) return undefined
  const seconds = Number(match[1])
  return Number.isFinite(seconds) ? seconds : undefined
}

function timestampAllowed(text: string, index: number, end: number, seconds: number, durationSeconds?: number) {
  if (durationSeconds && seconds > durationSeconds + 1) return false

  const prefix = text.slice(Math.max(0, index - 10), index)
  const suffix = text.slice(end, Math.min(text.length, end + 5))
  if (prefix.endsWith('T') || CLOCK_CONTEXT_PATTERN.test(prefix)) return false
  if (/^\s*(?:am|pm)\b/i.test(suffix)) return false
  return true
}

function linkTimestampText(node: MarkdownNode, durationSeconds?: number): MarkdownNode[] {
  const text = node.value ?? ''
  const output: MarkdownNode[] = []
  let cursor = 0

  for (const match of text.matchAll(TIMESTAMP_PATTERN)) {
    const index = match.index
    const label = match[0]
    const seconds = parseVideoTimestamp(label)
    if (seconds === undefined || !timestampAllowed(text, index, index + label.length, seconds, durationSeconds)) continue

    if (index > cursor) output.push({ type: 'text', value: text.slice(cursor, index) })
    output.push({
      type: 'link',
      url: videoTimestampHref(seconds),
      children: [{ type: 'text', value: label }],
    })
    cursor = index + label.length
  }

  if (cursor === 0) return [node]
  if (cursor < text.length) output.push({ type: 'text', value: text.slice(cursor) })
  return output
}

function transformNode(node: MarkdownNode, durationSeconds?: number) {
  if (!node.children || ['link', 'linkReference', 'code', 'inlineCode'].includes(node.type)) return

  const children: MarkdownNode[] = []
  for (const child of node.children) {
    if (child.type === 'text') children.push(...linkTimestampText(child, durationSeconds))
    else {
      transformNode(child, durationSeconds)
      children.push(child)
    }
  }
  node.children = children
}

export function remarkVideoTimestamps(options: VideoTimestampOptions = {}) {
  return (tree: MarkdownNode) => transformNode(tree, options.durationSeconds)
}
