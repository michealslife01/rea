import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { appDir, config, FORMATS, UserError } from './src/config.js';
import { deleteVideo, getJob, listVideos, startRender } from './src/render.js';
import { writeScript } from './src/script.js';

const MAX_SCENES = 40;
const TONES = ['energetic', 'calm', 'funny', 'inspiring', 'educational', 'dramatic'];

await fs.mkdir(config.outputDir, { recursive: true });

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(appDir, 'public')));
app.use('/videos', express.static(config.outputDir));

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

app.get('/api/status', async (_req, res) => {
  const music = await fs.readdir(config.musicDir).catch(() => []);
  res.json({
    claude: config.hasClaude,
    voice: Boolean(config.elevenLabsKey),
    footage: Boolean(config.pexelsKey),
    musicTracks: music.filter((file) => /\.(mp3|m4a|aac|wav|ogg)$/i.test(file)).length,
    formats: Object.keys(FORMATS),
    tones: TONES,
  });
});

app.post('/api/script', async (req, res) => {
  const prompt = text(req.body?.prompt, 2000);
  if (!prompt) throw new UserError('Describe your video idea first.');
  const seconds = Math.min(180, Math.max(10, Number(req.body?.seconds) || 30));
  const tone = TONES.includes(req.body?.tone) ? req.body.tone : 'energetic';
  res.json(await writeScript({ prompt, seconds, tone }));
});

app.post('/api/render', (req, res) => {
  const scenes = (Array.isArray(req.body?.scenes) ? req.body.scenes : [])
    .map((scene) => ({ narration: text(scene?.narration, 800), visual: text(scene?.visual, 100) }))
    .filter((scene) => scene.narration);
  if (!scenes.length) throw new UserError('Add at least one scene with narration.');
  if (scenes.length > MAX_SCENES) throw new UserError(`A video can have at most ${MAX_SCENES} scenes.`);
  const format = FORMATS[req.body?.format] ? req.body.format : '9:16';
  const job = startRender({
    title: text(req.body?.title, 120) || 'Untitled video',
    scenes,
    format,
    voice: req.body?.voice !== false,
  });
  res.status(202).json({ id: job.id });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown job' });
  res.json(job);
});

app.get('/api/videos', async (_req, res) => {
  res.json(await listVideos());
});

app.delete('/api/videos/:id', async (req, res) => {
  await deleteVideo(req.params.id);
  res.status(204).end();
});

app.use((error, _req, res, _next) => {
  if (error instanceof UserError) return res.status(400).json({ error: error.message });
  console.error(error);
  res.status(500).json({ error: `Unexpected error: ${error.message}` });
});

// Listen on this computer only; the app has no login.
app.listen(config.port, '127.0.0.1', () => {
  console.log(`VidGen is running: http://localhost:${config.port}`);
  console.log(`  Script writing (Claude): ${config.hasClaude ? 'on' : 'off - add ANTHROPIC_API_KEY to .env'}`);
  console.log(`  Voiceover (ElevenLabs):  ${config.elevenLabsKey ? 'on' : 'off - add ELEVENLABS_API_KEY to .env'}`);
  console.log(`  Stock footage (Pexels):  ${config.pexelsKey ? 'on' : 'off - add PEXELS_API_KEY to .env'}`);
});
