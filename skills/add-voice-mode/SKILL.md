---
name: add-voice-mode
description: >-
  Use when the user runs /add-voice-mode, types Voice Mode, or asks to add Grok
  realtime voice to an app. Wire speech-to-speech, safe auth, and app mic.
  For STT-LLM-TTS or OpenAI Realtime swaps use /upgrade-to-realtime-voice.
  For OOB or BYO evals use /add-voice-evals.
---

# Add Voice Mode

Add Grok Speech to Speech to an existing app. Run on `/add-voice-mode`, typed **Voice Mode**, or clear “add Grok voice” intent.

## Goal

Working duplex path: user-app mic in, audio out, `wss://api.x.ai/v1/realtime?model=grok-voice-latest`, safe auth. Cursor has no native mic; wire the **app** (or a sample client), not the IDE.

## Protocol first

Language-agnostic event loop. **TypeScript samples default.** Short Python twins only where the client API differs (e.g. `ws` vs `websockets`).

## Docs

- https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech
- https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens
- Pricing (cite docs only): https://docs.x.ai/developers/pricing (~$0.08/min STS + $0.004/text item; max session 120 min)

## Steps

1. **Map the app**
   - Stack: none, OpenAI Realtime, STT→LLM→TTS cascade, TTS/STT only.
   - Client: web / Node / iOS / Android / server.
   - If migrate: hand off to `/upgrade-to-realtime-voice` after auth plan is clear.

2. **Auth**
   - Server: Bearer `XAI_API_KEY`.
   - Browser/mobile: backend `POST https://api.x.ai/v1/realtime/client_secrets`, client uses ephemeral token (Bearer or browser `sec-websocket-protocol`: `xai-client-secret.<token>`).
   - Never put a long-lived key in client bundles. Do not paste keys in chat.

3. **Connect + session**
   - URL: `wss://api.x.ai/v1/realtime?model=grok-voice-latest`
   - On open: `session.update` with `voice` (default `eve`), `instructions`, `turn_detection: { type: "server_vad" }` (or `null` for push-to-talk), PCM 24 kHz unless the app already standardizes elsewhere.
   - Tools if needed: `web_search`, `x_search`, `file_search`, `mcp`, custom `function`.

4. **Audio I/O (app-side)**
   - Mic → `input_audio_buffer.append` (or binary transport).
   - Play `response.output_audio.delta` immediately.
   - Start WS and mic in parallel; buffer early audio.
   - On function tools: `function_call_output`, finish playback, then `response.create`.

5. **TS skeleton (default)**

```ts
const url = "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
// Node: pass Authorization header. Browser: use xai-client-secret.<token> protocol.
const ws = new WebSocket(url /* , { headers: { Authorization: `Bearer ${token}` } } */);

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({
    type: "session.update",
    session: {
      voice: "eve",
      instructions: "You are a helpful voice agent.",
      turn_detection: { type: "server_vad" },
    },
  }));
});

ws.addEventListener("message", (ev) => {
  const event = JSON.parse(String(ev.data));
  if (event.type === "response.output_audio.delta") {
    // decode base64 PCM and play
  }
});
```

6. **Python twin (only if the app is Python)**

```python
import json, os, websockets

url = "wss://api.x.ai/v1/realtime?model=grok-voice-latest"
headers = {"Authorization": f"Bearer {os.environ['XAI_API_KEY']}"}

async with websockets.connect(url, additional_headers=headers) as ws:
    await ws.send(json.dumps({
        "type": "session.update",
        "session": {
            "voice": "eve",
            "instructions": "You are a helpful voice agent.",
            "turn_detection": {"type": "server_vad"},
        },
    }))
    async for raw in ws:
        event = json.loads(raw)
        if event.get("type") == "response.output_audio.delta":
            pass  # decode and play
```

7. **Smoke**
   - Text turn via `conversation.item.create` + `response.create`; confirm audio or transcript events.
   - Confirm no long-lived key in client.
   - Then `/add-voice-evals` for OOB/BYO.

## Out of scope (v0)

- Imagine + text inference (later siblings)
- Marketplace publish without Eric’s yes
- Invented endpoints or CLI flags
- Creating Slack bots
