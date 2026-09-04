---
name: add-voice-evals
description: >-
  Use when the user runs /add-voice-evals or needs out-of-the-box voice smokes
  or bring-your-own clip/rubric hooks for a Grok realtime voice integration.
---

# Add Voice Evals

OOB smokes + BYO harness hooks for a Grok realtime voice path. No first-party xAI eval suite is documented; do not invent official scores.

## Docs

- Speech to Speech: https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech
- Pricing cite only: https://docs.x.ai/developers/pricing

## OOB (ship with the pack)

Run after `/add-voice-mode` or `/upgrade-to-realtime-voice`:

1. Connect with server key or ephemeral secret.
2. `session.update` succeeds (`session.updated`).
3. Text turn: `conversation.item.create` + `response.create` → audio or transcript events.
4. Audio round-trip: short clip in → audio delta out (or transcript).
5. Barge-in: with `server_vad`, interrupt mid-playback and confirm recovery.
6. Optional: one `function` tool call without overlapping speech (finish playback, then `response.create`).

Record pass/fail + time-to-first-audio when measurable. Concurrent session limits: UNKNOWN in docs; do not hardcode.

## BYO

Accept customer fixtures outside git if sensitive:

```
evals/byo/
  clips/           # audio inputs
  expected/        # optional transcripts or rubrics
  manifest.json    # id → clip + checks
```

Adapter maps customer layout → runner. Metrics hooks: connect success, TTFA, barge-in recovery, tool/audio overlap absent, optional WER if they supply transcripts.

## Out of scope

- Claiming AA STS or blog benchmark numbers as product truth
- Enterprise custom-voice **create** flows in default OOB
- Publishing results without Eric’s yes
