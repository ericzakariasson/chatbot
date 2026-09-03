const DEFAULT_BASE_URL = "https://api.x.ai/v1"
const ENCRYPTED_REASONING = "reasoning.encrypted_content"

export const models = {
  Grok46: "grok-4.6",
} as const

/** Responses input item. `{ role, content }` covers chat turns; extra fields pass through. */
export type InputItem = {
  role?: string
  content?: unknown
  type?: string
  [key: string]: unknown
}

export type StreamEvent = {
  type: string
  delta?: unknown
  message?: unknown
  [key: string]: unknown
}

export type Usage = {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number | null
}

export type ClientOptions = {
  apiKey: string
  fetch?: typeof fetch
  baseURL?: string
}

export type CreateParams = {
  model: string
  input: InputItem[]
  stream: true
  store?: boolean
  include?: string[]
}

export type RequestOpts = {
  signal?: AbortSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function int(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function emptyUsage(): Usage {
  return { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: null }
}

function mapUsage(raw: unknown): Usage {
  const u = isRecord(raw) ? raw : {}
  const nano = intOrNull(u.cost_in_nano_usd)
  return {
    input_tokens: int(u.input_tokens),
    output_tokens: int(u.output_tokens),
    total_tokens: int(u.total_tokens),
    cost_usd: nano != null ? nano / 1e9 : intOrNull(u.cost_usd),
  }
}

function requestIdFromHeaders(headers: Headers): string | null {
  return headers.get("x-request-id") ?? headers.get("request-id") ?? null
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) return value
  if (isRecord(value)) {
    const nested = isRecord(value.error) ? value.error : value
    if (typeof nested.message === "string" && nested.message.length > 0) {
      return nested.message
    }
  }
  return fallback
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        for (const item of flushBlocks(buf + decoder.decode()).items) {
          if (item === "[DONE]") return
          yield item
        }
        return
      }
      buf += decoder.decode(value, { stream: true })
      const { items, rest } = flushBlocks(buf)
      buf = rest
      for (const item of items) {
        if (item === "[DONE]") return
        yield item
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // already released
    }
  }
}

function flushBlocks(buf: string): { items: unknown[]; rest: string } {
  const parts = buf.split(/\r?\n\r?\n/)
  const rest = parts.pop() ?? ""
  const items: unknown[] = []
  for (const block of parts) {
    const parsed = parseBlock(block)
    if (parsed !== undefined) items.push(parsed)
  }
  return { items, rest }
}

function parseBlock(block: string): unknown | undefined {
  let eventName: string | undefined
  const dataLines: string[] = []
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "")
    if (!line || line.startsWith(":")) continue
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim()
      continue
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""))
    }
  }
  if (dataLines.length === 0) {
    return eventName === "ping" ? { type: "ping" } : undefined
  }
  const data = dataLines.join("\n")
  if (data === "[DONE]") return "[DONE]"
  try {
    const parsed: unknown = JSON.parse(data)
    if (eventName && isRecord(parsed) && parsed.type == null) {
      return { ...parsed, type: eventName }
    }
    return parsed
  } catch {
    return eventName === "ping" ? { type: "ping" } : { type: "unknown", raw: data }
  }
}

function normalizeEvent(raw: unknown): StreamEvent {
  if (!isRecord(raw)) return { type: "unknown", raw }
  const type = typeof raw.type === "string" ? raw.type : "unknown"
  if (type === "error") {
    return { ...raw, type: "error", message: errorMessage(raw, "Stream error") }
  }
  if (type === "response.failed") {
    const response = isRecord(raw.response) ? raw.response : null
    const message = errorMessage(raw.message ?? response?.error ?? response, "")
    return message ? { ...raw, type, message } : { ...raw, type }
  }
  return { ...raw, type }
}

class ResponseStream implements AsyncIterable<StreamEvent> {
  usage: Usage = emptyUsage()
  http: { requestId: string | null }
  #body: ReadableStream<Uint8Array> | null
  #output: InputItem[] = []
  #consumed = false

  constructor(init: { body: ReadableStream<Uint8Array> | null; requestId: string | null }) {
    this.#body = init.body
    this.http = { requestId: init.requestId }
  }

  toInput(): InputItem[] {
    return this.#output.map((item) => structuredClone(item))
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<StreamEvent> {
    if (this.#consumed) throw new Error("Stream already iterated")
    this.#consumed = true
    const body = this.#body
    this.#body = null
    if (!body) return
    try {
      for await (const raw of parseSse(body)) {
        const event = normalizeEvent(raw)
        this.#apply(event)
        yield event
      }
    } finally {
      try {
        await body.cancel()
      } catch {
        // already cancelled
      }
    }
  }

  #apply(event: StreamEvent): void {
    switch (event.type) {
      case "response.created":
      case "response.in_progress":
      case "response.completed":
      case "response.failed":
      case "response.incomplete": {
        const response = isRecord(event.response) ? event.response : null
        if (!response) break
        if (Array.isArray(response.output)) {
          this.#output = response.output as InputItem[]
        }
        if (response.usage !== undefined || event.type === "response.completed") {
          this.usage = mapUsage(response.usage)
        }
        break
      }
      case "response.output_item.added":
      case "response.output_item.done": {
        const index = int(event.output_index)
        const item = event.item
        if (!isRecord(item)) break
        while (this.#output.length < index) this.#output.push({ type: "message", role: "assistant", content: [] })
        this.#output[index] = item as InputItem
        break
      }
      case "response.output_text.delta": {
        const index = int(event.output_index)
        const contentIndex = int(event.content_index)
        const delta = typeof event.delta === "string" ? event.delta : ""
        this.#appendText(index, contentIndex, delta)
        break
      }
      case "response.output_text.done": {
        const index = int(event.output_index)
        const contentIndex = int(event.content_index)
        const text = typeof event.text === "string" ? event.text : ""
        this.#setText(index, contentIndex, text)
        break
      }
      default:
        break
    }
  }

  #ensureItem(index: number): Record<string, unknown> {
    while (this.#output.length <= index) {
      this.#output.push({ type: "message", role: "assistant", content: [] })
    }
    const item = this.#output[index]
    if (!isRecord(item)) {
      const next = { type: "message", role: "assistant", content: [] }
      this.#output[index] = next
      return next
    }
    return item
  }

  #appendText(index: number, contentIndex: number, delta: string): void {
    const item = this.#ensureItem(index)
    item.type = "message"
    item.role = item.role ?? "assistant"
    const content = Array.isArray(item.content) ? [...item.content] : []
    while (content.length <= contentIndex) content.push({ type: "output_text", text: "" })
    const part = content[contentIndex]
    if (isRecord(part) && part.type === "output_text") {
      content[contentIndex] = {
        ...part,
        text: `${typeof part.text === "string" ? part.text : ""}${delta}`,
      }
    } else {
      content[contentIndex] = { type: "output_text", text: delta }
    }
    item.content = content
  }

  #setText(index: number, contentIndex: number, text: string): void {
    const item = this.#ensureItem(index)
    const content = Array.isArray(item.content) ? [...item.content] : []
    while (content.length <= contentIndex) content.push({ type: "output_text", text: "" })
    content[contentIndex] = { type: "output_text", text }
    item.content = content
  }
}

export class Xai {
  readonly apiKey: string
  readonly baseURL: string
  readonly fetch: typeof fetch
  readonly responses: {
    create: (body: CreateParams, opts?: RequestOpts) => Promise<ResponseStream>
  }

  constructor(opts: ClientOptions) {
    if (!opts.apiKey) throw new Error("Xai: apiKey is missing")
    this.apiKey = opts.apiKey
    this.baseURL = (opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis)
    this.responses = {
      create: (body, requestOpts) => this.#create(body, requestOpts),
    }
  }

  async #create(body: CreateParams, opts?: RequestOpts): Promise<ResponseStream> {
    const store = body.store ?? false
    const payload: Record<string, unknown> = {
      ...body,
      store,
      stream: true,
    }
    if (body.include === undefined && store === false) {
      payload.include = [ENCRYPTED_REASONING]
    }

    const response = await this.fetch(`${this.baseURL}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
      signal: opts?.signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      let parsed: unknown = text
      try {
        parsed = text ? JSON.parse(text) : text
      } catch {
        parsed = text
      }
      throw new Error(errorMessage(parsed, response.statusText || `HTTP ${response.status}`))
    }

    return new ResponseStream({
      body: response.body,
      requestId: requestIdFromHeaders(response.headers),
    })
  }
}
