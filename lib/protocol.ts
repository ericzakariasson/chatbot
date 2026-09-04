import type { InputItem } from "@/lib/xai"

/** UI transcript row. Not the Responses API item shape. */
export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  thinking?: string
}

/**
 * NDJSON wire format between `POST /api/chat` and the browser.
 * One JSON object per line. Keep this tiny; do not stream raw SDK events.
 *
 *   { "type": "thinking", "text": "..." }
 *   { "type": "delta", "text": "..." }
 *   { "type": "done", "usage"?: UsageSummary, "requestId"?: string | null, "toInput"?: InputItem[] }
 *   { "type": "error", "message": "..." }
 */
export type UsageSummary = {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number | null
}

export type WireThinking = { type: "thinking"; text: string }
export type WireDelta = { type: "delta"; text: string }
export type WireDone = {
  type: "done"
  usage?: UsageSummary
  requestId?: string | null
  toInput?: InputItem[]
}
export type WireError = { type: "error"; message: string }
export type WireEvent = WireThinking | WireDelta | WireDone | WireError

export type ChatRequestBody = {
  /** Preferred: accumulated Responses `input` for the next turn. */
  input?: InputItem[]
  /** Fallback: rebuild input from the visible transcript. */
  messages?: ChatMessage[]
  model?: string
}

/** SDK stream events we care about for this demo. */
export type SdkLikeEvent = {
  type: string
  delta?: unknown
  message?: unknown
}

export function messagesToInput(messages: ChatMessage[]): InputItem[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => message.content.length > 0)
    .map((message) => ({ role: message.role, content: message.content }))
}

/**
 * Next-turn Responses `input`.
 * Prefer the last completed `toInput()` plus the new user turn (so encrypted
 * reasoning is kept when `store` is false). Otherwise map the transcript.
 */
export function buildNextInput(options: {
  priorInput: InputItem[] | null
  messages: ChatMessage[]
  userContent: string
}): InputItem[] {
  if (options.priorInput && options.priorInput.length > 0) {
    return [...options.priorInput, { role: "user", content: options.userContent }]
  }
  const history = messagesToInput(options.messages)
  return [...history, { role: "user", content: options.userContent }]
}

export function accumulateAfterTurn(
  sentInput: InputItem[],
  responseInput: InputItem[] | undefined,
): InputItem[] {
  if (responseInput && responseInput.length > 0) {
    return [...sentInput, ...responseInput]
  }
  return sentInput
}

export function mapSdkEvent(event: SdkLikeEvent): WireEvent | null {
  if (
    event.type === "response.reasoning_text.delta" ||
    event.type === "response.reasoning_summary_text.delta"
  ) {
    if (typeof event.delta !== "string" || event.delta.length === 0) return null
    return { type: "thinking", text: event.delta }
  }
  if (event.type === "response.output_text.delta") {
    if (typeof event.delta !== "string" || event.delta.length === 0) return null
    return { type: "delta", text: event.delta }
  }
  if (event.type === "error") {
    const message = typeof event.message === "string" && event.message.length > 0
      ? event.message
      : "Stream error"
    return { type: "error", message }
  }
  if (event.type === "response.failed") {
    const message = typeof event.message === "string" && event.message.length > 0
      ? event.message
      : "Response failed"
    return { type: "error", message }
  }
  return null
}

export function parseWireLine(line: string): WireEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const value = JSON.parse(trimmed) as unknown
  if (!value || typeof value !== "object") return null
  const rec = value as { type?: unknown }
  if (rec.type === "thinking" || rec.type === "delta" || rec.type === "done" || rec.type === "error") {
    return value as WireEvent
  }
  return null
}
