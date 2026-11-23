import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildAss, estimateWordTimings } from './captions.js';
import { config, FORMATS, UserError } from './config.js';
import { ffmpeg, mediaDuration } from './ffmpeg.js';
import { downloadStockClip } from './visuals.js';
import { synthesizeSpeech } from './voice.js';

// Background gradients used when a scene has no stock footage.
const PALETTES = [
  ['0x1e3a8a', '0x9333ea'],
  ['0x0f766e', '0x1d4ed8'],
  ['0x9d174d', '0xf97316'],
  ['0x111827', '0x475569'],
  ['0x14532d', '0x65a30d'],
];
const MUSIC_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg']);

const jobs = new Map();
// Videos render one at a time so several requests don't overload the computer.
let queue = Promise.resolve();

export const getJob = (id) => jobs.get(id);

export function startRender(request) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const id = `${stamp}-${crypto.randomBytes(2).toString('hex')}`;
  const job = { id, status: 'queued', progress: 0, step: 'Waiting for the previous video to finish', notes: [] };
  jobs.set(id, job);
  queue = queue.then(() => renderJob(job, request));
  return job;
}

function update(job, progress, step) {
  job.progress = Math.min(0.99, progress);
  job.step = step;
}

async function renderJob(job, { title, scenes, format: formatName, voice }) {
  const format = FORMATS[formatName];
  const dir = path.join(config.outputDir, job.id);
  const work = path.join(dir, 'work');
  const useVoice = voice && Boolean(config.elevenLabsKey);
  const usedClipIds = new Set();
  const credits = [];
  const durations = [];
  const totalSteps = scenes.length + 1;
  job.status = 'running';

  try {
    await fs.mkdir(work, { recursive: true });
    for (const [i, scene] of scenes.entries()) {
      const n = String(i).padStart(3, '0');
      const label = `Scene ${i + 1} of ${scenes.length}`;

      let audioFile = null;
      let words = null;
      let duration;
      if (useVoice) {
        update(job, i / totalSteps, `${label}: recording voiceover`);
        audioFile = `voice_${n}.mp3`;
        words = await synthesizeSpeech(scene.narration, path.join(work, audioFile));
        // A short pause after each line keeps scenes from running together.
        duration = (await mediaDuration(path.join(work, audioFile))) + 0.35;
      } else {
        // Without a voice, give viewers time to read: about 2.5 words a second.
        duration = Math.max(2.5, scene.narration.split(/\s+/).length / 2.5 + 0.6);
      }
      words ??= estimateWordTimings(scene.narration, useVoice ? duration - 0.35 : duration);

      let clipFile = null;
      if (config.pexelsKey && scene.visual) {
        update(job, (i + 0.33) / totalSteps, `${label}: finding footage for "${scene.visual}"`);
        const clip = await downloadStockClip(scene.visual, format, path.join(work, `clip_${n}.mp4`), usedClipIds);
        if (clip) {
          clipFile = `clip_${n}.mp4`;
          credits.push(clip);
        } else {
          job.notes.push(`No stock footage matched "${scene.visual}" (scene ${i + 1}), so it uses a plain background.`);
        }
      }

      update(job, (i + 0.66) / totalSteps, `${label}: rendering`);
      const captionsFile = `captions_${n}.ass`;
      await fs.writeFile(path.join(work, captionsFile), buildAss(words, { ...format, duration }));
      await renderScene({
        work,
        format,
        duration,
        clipFile,
        audioFile,
        captionsFile,
        palette: PALETTES[i % PALETTES.length],
        out: `scene_${n}.mp4`,
      });
      durations.push(duration);
    }

    update(job, scenes.length / totalSteps, 'Joining scenes into one video');
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    await fs.writeFile(
      path.join(work, 'scenes.txt'),
      scenes.map((_, i) => `file 'scene_${String(i).padStart(3, '0')}.mp4'`).join('\n'),
    );
    const music = await pickMusic();
    const joined = music ? 'joined.mp4' : '../video.mp4';
    await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', 'scenes.txt', '-c', 'copy', '-movflags', '+faststart', joined], { cwd: work });
    if (music) {
      update(job, (scenes.length + 0.5) / totalSteps, 'Adding background music');
      await addMusic(work, joined, music, totalDuration);
    }
    await ffmpeg(['-y', '-ss', '0.8', '-i', 'video.mp4', '-frames:v', '1', '-vf', 'scale=360:-2', 'thumb.jpg'], { cwd: dir });

    const meta = {
      id: job.id,
      title,
      format: formatName,
      duration: Number(totalDuration.toFixed(1)),
      createdAt: new Date().toISOString(),
      voice: useVoice,
      music: music ? path.basename(music) : null,
      scenes,
      footage: credits,
      notes: job.notes,
    };
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    await fs.rm(work, { recursive: true, force: true });
    Object.assign(job, { status: 'done', progress: 1, step: 'Done', video: meta });
  } catch (error) {
    console.error(`Render ${job.id} failed:`, error instanceof UserError ? error.message : error);
    job.status = 'error';
    job.error = error instanceof UserError ? error.message : `Rendering failed: ${error.message}`;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function renderScene({ work, format, duration, clipFile, audioFile, captionsFile, palette, out }) {
  const { width: w, height: h } = format;
  const seconds = duration.toFixed(3);
  const args = ['-y'];
  if (clipFile) {
    // Loop the clip in case it is shorter than the narration.
    args.push('-stream_loop', '-1', '-i', clipFile);
  } else {
    args.push('-f', 'lavfi', '-i', `gradients=s=${w}x${h}:r=30:c0=${palette[0]}:c1=${palette[1]}:speed=0.015:d=${seconds}`);
  }
  if (audioFile) args.push('-i', audioFile);
  else args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');

  const video = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p,subtitles=${captionsFile}[v]`;
  const audio = '[1:a]aresample=44100,aformat=channel_layouts=stereo,apad[a]';
  args.push(
    '-filter_complex', `${video};${audio}`,
    '-map', '[v]', '-map', '[a]',
    '-t', seconds,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
    '-c:a', 'aac', '-b:a', '160k',
    out,
  );
  await ffmpeg(args, { cwd: work });
}

/** A random track from the music/ folder, if there is one. */
async function pickMusic() {
  const files = await fs.readdir(config.musicDir).catch(() => []);
  const tracks = files.filter((file) => MUSIC_EXTENSIONS.has(path.extname(file).toLowerCase()));
  if (!tracks.length) return null;
  return path.join(config.musicDir, tracks[Math.floor(Math.random() * tracks.length)]);
}

async function addMusic(work, joined, music, totalDuration) {
  const fadeStart = Math.max(0, totalDuration - 1.5).toFixed(2);
  const mix = `[1:a]volume=0.15,afade=t=out:st=${fadeStart}:d=1.5[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`;
  await ffmpeg(
    [
      '-y', '-i', joined, '-stream_loop', '-1', '-i', music,
      '-filter_complex', mix,
      '-map', '0:v', '-map', '[a]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
      '-t', totalDuration.toFixed(3), '-movflags', '+faststart',
      '../video.mp4',
    ],
    { cwd: work },
  );
}

/** Every finished video, newest first. */
export async function listVideos() {
  const entries = await fs.readdir(config.outputDir, { withFileTypes: true }).catch(() => []);
  const videos = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      videos.push(JSON.parse(await fs.readFile(path.join(config.outputDir, entry.name, 'meta.json'), 'utf8')));
    } catch {
      // Not a finished video (still rendering, or failed).
    }
  }
  return videos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteVideo(id) {
  if (!/^[\w-]+$/.test(id)) throw new UserError('Unknown video');
  await fs.rm(path.join(config.outputDir, id), { recursive: true, force: true });
}
