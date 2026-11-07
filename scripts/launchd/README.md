# Laya background services (macOS)

Two login services keep Laya's judgments current without a browser tab open:

- `ai.leadpulse.laya-server` runs the local Laya server on `127.0.0.1:8765`.
- `ai.leadpulse.laya-worker` runs `scripts/laya-judgment-worker.ts --watch 900`: every 15 minutes
  it saves fit judgments for new or edited prospects and buyer-reply judgments for deals into
  `laya_judgments`. The Hermes enrichment queue reads the fit judgments to research likely buyers first.

The worker reads new buyer replies with Liquid AI's LFM3-1.7B (the whole deal set; Laya
still judges prospect fit). It needs `brew install llama.cpp` (0.8.0 or newer) and the model at
`~/Models/LiquidAI/LFM3-1.7B-GGUF/LFM3-1.7B-Q4_K_M.gguf`; it starts `llama-server` on
`127.0.0.1:8766` only while it has replies to read, then stops it. Without them, that part
logs `lfm3_reader_missing` and new replies stay unjudged. To go back to Laya reading deals,
add `--deal-reader laya` to the worker's arguments in its plist (or set
`LAYA_DEAL_READER=laya`) and restart it.

The worker needs the service-role key in `~/.config/leadpulse/supabase-secret-key` (mode 600).
Both run from this working tree, so a checkout of a broken branch stops them until you switch back.

Install (run each in Terminal):

```bash
mkdir -p ~/Library/Logs/leadpulse
cp scripts/launchd/ai.leadpulse.laya-*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.leadpulse.laya-server.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.leadpulse.laya-worker.plist
```

Check: `launchctl print gui/$(id -u)/ai.leadpulse.laya-worker | grep state` and
`tail ~/Library/Logs/leadpulse/laya-worker.log` (counts only; never reply text or keys).

Remove:

```bash
launchctl bootout gui/$(id -u)/ai.leadpulse.laya-worker
launchctl bootout gui/$(id -u)/ai.leadpulse.laya-server
rm ~/Library/LaunchAgents/ai.leadpulse.laya-*.plist
```
