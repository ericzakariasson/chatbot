import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  accumulateAfterTurn,
  buildNextInput,
  mapSdkEvent,
  messagesToInput,
  parseWireLine,
  type ChatMessage,
} from "../lib/protocol"

const user: ChatMessage = { id: "u1", role: "user", content: "Hello" }
const assistant: ChatMessage = { id: "a1", role: "assistant", content: "Hi" }

describe("protocol", () => {
  it("maps output_text deltas and ignores other events", () => {
    assert.deepEqual(mapSdkEvent({ type: "response.output_text.delta", delta: "Hel" }), {
      type: "delta",
      text: "Hel",
    })
    assert.deepEqual(mapSdkEvent({ type: "response.reasoning_text.delta", delta: "Let" }), {
      type: "thinking",
      text: "Let",
    })
    assert.deepEqual(
      mapSdkEvent({ type: "response.reasoning_summary_text.delta", delta: " me" }),
      { type: "thinking", text: " me" },
    )
    assert.equal(mapSdkEvent({ type: "response.reasoning_text.done", text: "Let me" }), null)
    assert.equal(mapSdkEvent({ type: "response.created" }), null)
    assert.deepEqual(mapSdkEvent({ type: "error", message: "overloaded" }), {
      type: "error",
      message: "overloaded",
    })
    assert.deepEqual(mapSdkEvent({ type: "response.failed" }), {
      type: "error",
      message: "Response failed",
    })
  })

  it("rebuilds Responses input from the transcript when toInput is missing", () => {
    assert.deepEqual(messagesToInput([user, assistant]), [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ])
    assert.deepEqual(
      buildNextInput({ priorInput: null, messages: [user, assistant], userContent: "Again" }),
      [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
        { role: "user", content: "Again" },
      ],
    )
  })

  it("round-trips stored toInput payloads for the next turn", () => {
    const prior = [
      { role: "user" as const, content: "Hello" },
      { type: "reasoning" as const, encrypted_content: "enc" },
      { type: "message" as const, role: "assistant" as const, content: "Hi" },
    ]
    const next = buildNextInput({
      priorInput: prior,
      messages: [user, assistant],
      userContent: "Again",
    })
    assert.deepEqual(next, [...prior, { role: "user", content: "Again" }])
    assert.deepEqual(
      accumulateAfterTurn(next, [{ type: "message", role: "assistant", content: "Sure" }]),
      [...next, { type: "message", role: "assistant", content: "Sure" }],
    )
  })

  it("parses NDJSON wire lines", () => {
    assert.deepEqual(parseWireLine('{"type":"delta","text":"x"}'), { type: "delta", text: "x" })
    assert.equal(parseWireLine(""), null)
    assert.equal(parseWireLine('{"type":"ping"}'), null)
  })
})
