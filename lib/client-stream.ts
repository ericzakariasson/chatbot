import type { WireEvent } from "@/lib/protocol"
import { parseWireLine } from "@/lib/protocol"

export async function readChatStream(
  response: Response,
  onEvent: (event: WireEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("Chat response had no body")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const event = parseWireLine(line)
      if (event) onEvent(event)
    }
  }

  const tail = parseWireLine(buffer)
  if (tail) onEvent(tail)
}
