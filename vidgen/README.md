# VidGen

Turn an idea into a short narrated video, on your own computer.

1. **Idea → script.** Claude writes a scene-by-scene script, or you write it yourself.
2. **Edit.** Change any line, or the footage search for any scene.
3. **Generate.** VidGen records a voiceover (ElevenLabs), finds stock clips (Pexels), adds word-by-word captions, mixes in background music, and saves an MP4.

Videos come out as vertical 9:16 (TikTok, Reels, Shorts), wide 16:9 (YouTube), or square 1:1.

## Setup (about 10 minutes)

You need **Node.js 20 or newer**. Get it from https://nodejs.org (choose "LTS"). FFmpeg is bundled, so you don't need to install it.

```bash
cd vidgen
npm install
cp .env.example .env
```

Open `.env` in a text editor and paste in the keys you have. Every key is optional. Without them you can still make videos with your own script, plain colour backgrounds, and captions.

| Key | What it turns on | Where to get it | Cost |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | AI script writing | https://console.anthropic.com/settings/keys | A few cents per script |
| `ELEVENLABS_API_KEY` | Voiceover, with captions timed to the voice | https://elevenlabs.io/app/settings/api-keys | Free tier (about 10 minutes of speech a month), then paid plans |
| `PEXELS_API_KEY` | Stock video footage | https://www.pexels.com/api/ | Free |

To pick a different voice, copy a voice ID from the ElevenLabs voice library into `ELEVENLABS_VOICE_ID`.

For **background music**, put royalty-free MP3 files in the `music/` folder. Each video gets a random track mixed quietly under the voice. Only use music you have the rights to.

## Run it

```bash
npm start
```

Then open http://localhost:3000. Finished videos are saved in `output/`, one folder per video.

After changing `.env`, stop the app (Ctrl+C) and run `npm start` again.

## Check that it works

```bash
npm run check
```

This renders real test videos using fake ElevenLabs and Pexels responses, so it needs no keys and no internet.

## How it works

| File | Job |
|---|---|
| `server.js` | The web server and its API |
| `src/script.js` | Asks Claude for a script as structured JSON: a title plus scenes, each with narration and a footage search |
| `src/voice.js` | ElevenLabs text-to-speech, including when each word is spoken |
| `src/visuals.js` | Searches Pexels and downloads a clip that fits the video's shape |
| `src/captions.js` | Builds the captions: three words at a time, with the spoken word in yellow |
| `src/render.js` | Renders each scene with FFmpeg, joins the scenes, adds music, and saves the result |
| `public/` | The web page |

Each scene runs for as long as its voiceover. Short clips loop, and every clip is cropped to fill the frame. Without a voice, the captions are timed at a comfortable reading speed instead.

## Ideas for what to build next

- Post straight to TikTok, YouTube, or Instagram
- AI-generated footage or images (Runway, Luma, Veo) for scenes with no good stock clip
- Upload your own clips and images per scene
- Pick a voice and caption style in the app
- Accounts and payments, if you want to offer it to other people (that also means hosting it on a server)

## Troubleshooting

- **"No Claude API key found"**: add `ANTHROPIC_API_KEY` to `.env`, then restart the app.
- **"ElevenLabs rejected the API key or ran out of credits"**: check the key, or your quota at elevenlabs.io.
- **A scene has a plain background**: Pexels had nothing for that search. Use simpler, concrete words, such as "dog running beach".
- **Rendering is slow**: a 60-second video takes about a minute on a typical laptop. Videos render one at a time.
