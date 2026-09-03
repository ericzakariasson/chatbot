import { models, Xai, type InputItem } from "@xai/sdk"

import {
  mapSdkEvent,
  messagesToInput,
  type ChatRequestBody,
  type UsageSummary,
  type WireEvent,
} from "@/lib/protocol"

export const runtime = "nodejs"

function encode(event: WireEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`)
}

function resolveInput(body: ChatRequestBody): InputItem[] {
  if (Array.isArray(body.input) && body.input.length > 0) {
    return body.input
  }
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    return messagesToInput(body.messages)
  }
  throw new Error("Request must include input or messages")
}

export async function POST(request: Request) {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    return Response.json(
      { type: "error", message: "XAI_API_KEY is not set" } satisfies WireEvent,
      { status: 500 },
    )
  }

  let body: ChatRequestBody
  try {
    body = (await request.json()) as ChatRequestBody
  } catch {
    return Response.json(
      { type: "error", message: "Invalid JSON body" } satisfies WireEvent,
      { status: 400 },
    )
  }

  let input: InputItem[]
  try {
    input = resolveInput(body)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request"
    return Response.json({ type: "error", message } satisfies WireEvent, { status: 400 })
  }

  const client = new Xai({ apiKey })
  const stream = await client.responses.create(
    {
      model: body.model ?? models.Grok46,
      input,
      stream: true,
    },
    { signal: request.signal },
  )

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          const mapped = mapSdkEvent(event)
          if (mapped) controller.enqueue(encode(mapped))
        }
        const usage: UsageSummary = {
          input_tokens: stream.usage.input_tokens,
          output_tokens: stream.usage.output_tokens,
          total_tokens: stream.usage.total_tokens,
          cost_usd: stream.usage.cost_usd,
        }
        controller.enqueue(
          encode({
            type: "done",
            usage,
            requestId: stream.http.requestId,
            toInput: stream.toInput(),
          }),
        )
      } catch (error) {
        if (request.signal.aborted) return
        const message = error instanceof Error ? error.message : "Chat request failed"
        controller.enqueue(encode({ type: "error", message }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}
