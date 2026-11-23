import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { config } from './config.js';

const ffmpegBinary = config.ffmpegPath || ffmpegStatic || 'ffmpeg';

function run(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary, ['-hide_banner', ...args], { cwd });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

export async function ffmpeg(args, options) {
  const { code, stderr } = await run(['-loglevel', 'error', ...args], options);
  if (code !== 0) {
    throw new Error(`ffmpeg exited with code ${code}: ${stderr.trim().slice(-1500)}`);
  }
}

/** Duration of a media file in seconds. */
export async function mediaDuration(file) {
  // With no output file ffmpeg exits non-zero, but still prints the input's duration.
  const { stderr } = await run(['-i', file]);
  const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!match) throw new Error(`Could not read the duration of ${file}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}
