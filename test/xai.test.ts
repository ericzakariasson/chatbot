import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { models, Xai, type InputItem } from "../lib/xai"

function sseResponse(events: string[], headers?: HeadersInit): Response {
  const body = events.map((event) => `data: ${event}\n\n`).join("") + "data: [DONE]\n\n"
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  })
}

describe("xai client", () => {
  it("exposes grok-4.6 as models.Grok46", () => {
    assert.equal(models.Grok46, "grok-4.6")
  })

  it("streams output_text deltas and surfaces usage, requestId, and toInput", async () => {
    const output: InputItem[] = [
      { type: "reasoning", encrypted_content: "enc" },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Hello" }],
      },
    ]
    let request: Request | undefined
    const client = new Xai({
      apiKey: "test-key",
      fetch: async (input, init) => {
        request = new Request(input, init)
        return sseResponse(
          [
            JSON.stringify({ type: "response.output_text.delta", delta: "Hel" }),
            JSON.stringify({ type: "response.output_text.delta", delta: "lo" }),
            JSON.stringify({
              type: "response.completed",
              response: {
                output,
                usage: {
                  input_tokens: 3,
                  output_tokens: 2,
                  total_tokens: 5,
                  cost_in_nano_usd: 1_500_000,
                },
              },
            }),
          ],
          { "x-request-id": "req_123" },
        )
      },
    })

    const stream = await client.responses.create(
      {
        model: models.Grok46,
        input: [{ role: "user", content: "Hi" }],
        stream: true,
      },
      { signal: undefined },
    )

    const events = []
    for await (const event of stream) events.push(event)

    assert.equal(request?.headers.get("authorization"), "Bearer test-key")
    const body = JSON.parse((await request?.text()) ?? "{}") as Record<string, unknown>
    assert.equal(body.model, "grok-4.6")
    assert.equal(body.stream, true)
    assert.equal(body.store, false)
    assert.deepEqual(body.include, ["reasoning.encrypted_content"])
    assert.deepEqual(body.input, [{ role: "user", content: "Hi" }])

    assert.deepEqual(
      events.filter((event) => event.type === "response.output_text.delta").map((event) => event.delta),
      ["Hel", "lo"],
    )
    assert.deepEqual(stream.usage, {
      input_tokens: 3,
      output_tokens: 2,
      total_tokens: 5,
      cost_usd: 0.0015,
    })
    assert.equal(stream.http.requestId, "req_123")
    assert.deepEqual(stream.toInput(), output)
  })

  it("maps error and response.failed events", async () => {
    const client = new Xai({
      apiKey: "test-key",
      fetch: async () =>
        sseResponse([
          JSON.stringify({ type: "error", message: "overloaded" }),
          JSON.stringify({
            type: "response.failed",
            response: { error: { message: "bad request" } },
          }),
        ]),
    })

    const stream = await client.responses.create({
      model: "grok-4.6",
      input: [{ role: "user", content: "Hi" }],
      stream: true,
    })

    const events = []
    for await (const event of stream) events.push(event)

    assert.deepEqual(
      events.find((event) => event.type === "error"),
      { type: "error", message: "overloaded" },
    )
    assert.equal(events.find((event) => event.type === "response.failed")?.message, "bad request")
  })

  it("throws HTTP errors without streaming", async () => {
    const client = new Xai({
      apiKey: "test-key",
      fetch: async () =>
        Response.json({ error: { message: "invalid api key" } }, { status: 401 }),
    })

    await assert.rejects(
      () =>
        client.responses.create({
          model: "grok-4.6",
          input: [{ role: "user", content: "Hi" }],
          stream: true,
        }),
      /invalid api key/,
    )
  })

  it("forwards the abort signal to fetch", async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const client = new Xai({
      apiKey: "test-key",
      fetch: async (_input, init) => {
        seen = init?.signal ?? undefined
        return sseResponse([JSON.stringify({ type: "response.completed", response: { output: [] } })])
      },
    })

    await client.responses.create(
      { model: "grok-4.6", input: [{ role: "user", content: "Hi" }], stream: true },
      { signal: controller.signal },
    )

    assert.equal(seen, controller.signal)
  })
})
