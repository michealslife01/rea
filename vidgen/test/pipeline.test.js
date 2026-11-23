// Renders real videos with ffmpeg, with ElevenLabs and Pexels replaced by
// local fakes so no API keys or network are needed. Run with: npm run check
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import ffmpegStatic from 'ffmpeg-static';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidgen-test-'));
Object.assign(process.env, {
  OUTPUT_DIR: path.join(tmp, 'output'),
  MUSIC_DIR: path.join(tmp, 'music'),
  ELEVENLABS_API_KEY: 'test-key',
  PEXELS_API_KEY: 'test-key',
});
const ffmpegBin = process.env.FFMPEG_PATH || ffmpegStatic;
const ffmpeg = (...args) => execFileSync(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const probe = (file) => {
  try {
    execFileSync(ffmpegBin, ['-hide_banner', '-i', file], { stdio: 'pipe' });
  } catch (error) {
    return error.stderr.toString();
  }
};

const fixtures = {
  voice: path.join(tmp, 'voice.mp3'),
  clip: path.join(tmp, 'clip.mp4'),
};
const { getJob, startRender } = await import('../src/render.js');
const { buildAss, groupIntoLines } = await import('../src/captions.js');
const { wordsFromAlignment } = await import('../src/voice.js');

let elevenLabsStatus = 200;
const realFetch = globalThis.fetch;

before(() => {
  fs.mkdirSync(process.env.MUSIC_DIR);
  ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', fixtures.voice);
  // A short landscape clip: it has to be looped and cropped to fill a vertical frame.
  ffmpeg('-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=25:duration=1.5', '-pix_fmt', 'yuv420p', fixtures.clip);
  ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', path.join(process.env.MUSIC_DIR, 'track.mp3'));

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://api.elevenlabs.io/')) {
      if (elevenLabsStatus !== 200) return new Response('invalid api key', { status: elevenLabsStatus });
      const { text } = JSON.parse(init.body);
      const characters = [...text];
      const step = 1.8 / characters.length;
      return Response.json({
        audio_base64: fs.readFileSync(fixtures.voice).toString('base64'),
        alignment: {
          characters,
          character_start_times_seconds: characters.map((_, i) => i * step),
          character_end_times_seconds: characters.map((_, i) => (i + 1) * step),
        },
      });
    }
    if (url.startsWith('https://api.pexels.com/videos/search')) {
      const query = new URL(url).searchParams.get('query');
      if (query.includes('nothing')) return Response.json({ videos: [] });
      return Response.json({
        videos: [1, 2].map((id) => ({
          id,
          url: `https://www.pexels.com/video/${id}/`,
          user: { name: 'Test Author' },
          video_files: [
            { file_type: 'video/mp4', width: 640, height: 360, link: 'https://videos.example/small.mp4' },
            { file_type: 'video/mp4', width: 1280, height: 720, link: 'https://videos.example/clip.mp4' },
          ],
        })),
      });
    }
    if (url === 'https://videos.example/clip.mp4') return new Response(fs.readFileSync(fixtures.clip));
    throw new Error(`Unexpected fetch in test: ${url}`);
  };
});

after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function finish(job) {
  while (!['done', 'error'].includes(getJob(job.id).status)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return getJob(job.id);
}

test('renders a vertical video with voice, footage, captions and music', async () => {
  const job = await finish(
    startRender({
      title: 'Test',
      format: '9:16',
      voice: true,
      scenes: [
        { narration: 'Octopuses have three hearts.', visual: 'octopus' },
        { narration: 'Their blood is blue!', visual: 'ocean' },
        { narration: 'Follow for more.', visual: 'nothing matches this' },
      ],
    }),
  );
  assert.equal(job.status, 'done', job.error);
  const dir = path.join(process.env.OUTPUT_DIR, job.id);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['meta.json', 'thumb.jpg', 'video.mp4']);

  const info = probe(path.join(dir, 'video.mp4'));
  assert.match(info, /Video: h264.*1080x1920/);
  assert.match(info, /Audio: aac/);
  const [, h, m, s] = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
  // Three 2-second voice lines plus a short pause after each.
  assert.ok(Math.abs(seconds - 3 * 2.35) < 0.3, `unexpected duration ${seconds}`);

  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  assert.equal(meta.voice, true);
  assert.equal(meta.music, 'track.mp3');
  // Each scene gets a different clip; the third falls back to a background.
  assert.deepEqual(meta.footage.map((f) => f.id), [1, 2]);
  assert.match(meta.notes[0], /nothing matches this/);
});

test('renders wide and square formats without voice', async () => {
  for (const [format, size] of [['16:9', '1920x1080'], ['1:1', '1080x1080']]) {
    const job = await finish(
      startRender({ title: format, format, voice: false, scenes: [{ narration: 'Just captions here.', visual: 'city' }] }),
    );
    assert.equal(job.status, 'done', job.error);
    assert.match(probe(path.join(process.env.OUTPUT_DIR, job.id, 'video.mp4')), new RegExp(`Video: h264.*${size}`));
    assert.equal(job.video.voice, false);
  }
});

test('a rejected voice key fails the job with a clear message and leaves no files', async () => {
  elevenLabsStatus = 401;
  try {
    const job = await finish(startRender({ title: 'x', format: '9:16', voice: true, scenes: [{ narration: 'Hi.', visual: '' }] }));
    assert.equal(job.status, 'error');
    assert.match(job.error, /ElevenLabs rejected the API key/);
    assert.equal(fs.existsSync(path.join(process.env.OUTPUT_DIR, job.id)), false);
  } finally {
    elevenLabsStatus = 200;
  }
});

test('captions group words into short lines and highlight the spoken word', () => {
  const words = 'One two three four. Five {six}'.split(' ').map((word, i) => ({ word, start: i, end: i + 0.9 }));
  assert.deepEqual(
    groupIntoLines(words).map((line) => line.map((w) => w.word).join(' ')),
    ['One two three', 'four.', 'Five {six}'],
  );
  const ass = buildAss(words, { width: 1080, height: 1920, duration: 6 });
  assert.equal(ass.match(/^Dialogue:/gm).length, 6);
  assert.match(ass, /\{\\c&H0000E5FF&\}One\{\\c&H00FFFFFF&\} two three/);
  // Braces in spoken text must not become ASS markup.
  assert.match(ass, /Five \{\\c&H0000E5FF&\}six\{/);
});

test('ElevenLabs character timings become word timings', () => {
  const words = wordsFromAlignment({
    characters: [...'Hi you'],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  });
  assert.deepEqual(words, [
    { word: 'Hi', start: 0, end: 0.2 },
    { word: 'you', start: 0.3, end: 0.6 },
  ]);
  assert.equal(wordsFromAlignment(null), null);
});
