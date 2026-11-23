import 'dotenv/config';
import path from 'node:path';

const env = (name) => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

export const config = {
  port: Number(env('PORT')) || 3000,
  // The Anthropic SDK reads ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) itself.
  hasClaude: Boolean(env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN')),
  elevenLabsKey: env('ELEVENLABS_API_KEY'),
  elevenLabsVoice: env('ELEVENLABS_VOICE_ID') || '21m00Tcm4TlvDq8ikWAM',
  elevenLabsModel: env('ELEVENLABS_MODEL_ID') || 'eleven_multilingual_v2',
  pexelsKey: env('PEXELS_API_KEY'),
  outputDir: path.resolve(env('OUTPUT_DIR') || 'output'),
  musicDir: path.resolve(env('MUSIC_DIR') || 'music'),
  ffmpegPath: env('FFMPEG_PATH'),
};

// Width, height, and the matching Pexels orientation for each aspect ratio.
export const FORMATS = {
  '9:16': { width: 1080, height: 1920, orientation: 'portrait' },
  '16:9': { width: 1920, height: 1080, orientation: 'landscape' },
  '1:1': { width: 1080, height: 1080, orientation: 'square' },
};

/** An error whose message is safe and useful to show in the app. */
export class UserError extends Error {}
