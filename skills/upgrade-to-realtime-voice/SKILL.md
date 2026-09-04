---
name: upgrade-to-realtime-voice
description: >-
  Use when the user runs /upgrade-to-realtime-voice or wants to rip out an
  STT→LLM→TTS cascade or OpenAI Realtime stack and wire Grok native
  speech-to-speech realtime instead.
---

# Upgrade to Realtime Voice

Rip out cascade (or OpenAI Realtime) and wire Grok Speech to Speech. Not “build cascade.” Pair with `/add-voice-mode` for greenfield.

## Cascade means

Kevin’s cascade = **STT → LLM → TTS** (separate ASR, chat, speak). Target = one duplex loop on `wss://api.x.ai/v1/realtime?model=grok-voice-latest`.

Also covers **OpenAI Realtime → Grok** (URL + key + model + voice swap, event diffs).

## Docs

- https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech (Migrating from OpenAI Realtime)
- STT: https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
- TTS: https://docs.x.ai/developers/model-capabilities/audio/text-to-speech

## Steps

1. **Inventory**
   - List STT provider, LLM, TTS, turn-taking, tools, audio format.
   - Or note OpenAI Realtime base URL, model, events used.

2. **Choose collapse vs keep**
   - Live duplex conversation → full collapse to realtime.
   - Keep standalone `POST/wss /v1/stt` or `/v1/tts` only if the product still needs one-shot listen/speak outside the agent.

3. **OpenAI Realtime path**
   - Base → `https://api.x.ai/v1` / `wss://api.x.ai/v1/realtime`
   - Model → `grok-voice-latest`
   - Voice → Grok voice (e.g. `eve`); console custom voice IDs OK; **create** custom voice API is Enterprise-gated.
   - Trim GPT workaround prompt strings.
   - Diff events: some OpenAI events unsupported; xAI adds `force_message`, `resumption`, `replace`.

4. **Classic cascade path**
   - Remove the three-hop glue (STT result → chat → TTS).
   - Single session: mic buffer in, `session.update`, play audio deltas out.
   - Re-home tools onto realtime `session.tools` (`function`, `web_search`, `x_search`, `file_search`, `mcp`).

5. **TS pointer (default)**

```ts
// before: stt.transcribe → chat.completions → tts.speak
// after:
const ws = new WebSocket("wss://api.x.ai/v1/realtime?model=grok-voice-latest");
// session.update + input_audio_buffer.append + response.output_audio.delta
```

6. **Auth**
   - Same as `/add-voice-mode`: server API key; browser via ephemeral `POST /v1/realtime/client_secrets`.

7. **Verify**
   - Latency and barge-in better than cascade.
   - Run `/add-voice-evals` OOB smokes.
   - Hold publish until Eric says yes.
