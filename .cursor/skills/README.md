Draft Cursor skills for Grok Voice. They are not published to the marketplace. Iterate on them in this PR.

- `add-voice`: build speech-to-speech into an app, or replace a cascade / OpenAI Realtime with it.
- `upgrade-voice-mode`: bring an existing integration up to the latest xAI API by pulling the current docs (draft).
- `add-dictation`: speech-to-text, batch for a mic button or recorded audio, streaming through a relay for live text.
- `add-read-aloud`: text-to-speech, batch MP3 for a speaker button on replies, streaming PCM through a relay for audio before the reply finishes.
- `debug-voice`: plan first, then install a dev-only log pipeline (client logger → local NDJSON) in the app's own language and conventions, then run the fix loop with the symptom → log signature → fix table.

Icon convention across the skills: waveform = voice mode, microphone = dictation, speaker = read aloud.
