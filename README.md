# Skool Daily Digest

A Chrome extension that scrapes your Skool community feed and generates an AI-powered daily briefing — so you never miss what matters.

Built for the **Early AI-dopters** community on Skool.

---

## Features

- **AI Digest** — Ranks all posts by importance with summaries, key insights, and tags
- **Multi-provider** — Works with Claude (Anthropic), GPT (OpenAI), or Gemini (Google)
- **Watched Members** — Pin specific members so their posts always surface at the top
- **Dark / Light mode** — Toggle from the header
- **Export** — Open digest as `.md` or styled `.html` in a new tab, or copy Markdown to clipboard
- **Smart cache** — Digest is cached for the day; refresh anytime with the ↺ button

---

## Installation (Developer Mode)

This extension is not on the Chrome Web Store. Install it manually:

1. Download or clone this repo
   ```
   git clone https://github.com/afrozahmad07/skool-digest.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `skool-digest` folder
5. The extension icon will appear in your toolbar

---

## Setup

1. Click the extension icon → go to the **Settings** tab
2. Choose your AI provider (Claude recommended)
3. Paste your API key:
   - **Claude** → [console.anthropic.com](https://console.anthropic.com)
   - **OpenAI** → [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - **Gemini** → [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
4. Optionally add **Watched Members** (exact names as shown on Skool)
5. Click **Save Settings**

---

## Usage

1. Navigate to your Skool community feed (`https://www.skool.com/your-community`)
2. Set the feed sort to **New** for best results
3. Click the extension icon → hit **Generate Feed Digest**
4. The AI analyses all visible posts and returns a ranked digest in ~5–15 seconds

---

## Project Structure

```
skool-digest/
├── manifest.json        # Chrome extension config (Manifest V3)
├── popup.html           # Extension popup UI
├── icons/               # Extension icons (16, 48, 128px)
└── src/
    ├── popup.js         # Popup logic, rendering, settings, export
    ├── api.js           # AI provider calls (Claude / OpenAI / Gemini)
    ├── content.js       # DOM scraper injected into Skool feed pages
    └── storage.js       # Chrome local storage helpers
```

---

## AI Providers

| Provider | Model | Notes |
|----------|-------|-------|
| Claude | claude-sonnet-4-6 | Default. Uses prompt caching for faster repeat runs |
| OpenAI | gpt-5.5 | JSON mode enabled |
| Gemini | gemini-2.0-flash / 2.5-flash | Auto-fallback between models |

---

## Watched Members

Add member names in Settings to make their posts always appear near the top of the digest, regardless of engagement. Names must match exactly how they appear on Skool (as shown in the avatar tooltip).

---

## License

MIT
