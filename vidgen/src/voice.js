import fs from 'node:fs/promises';
import { config, UserError } from './config.js';

/**
 * Speak `text` with ElevenLabs and save it as an MP3.
 * Returns word timings from the voice's own alignment, or null if none came back.
 * @returns {Promise<{word: string, start: number, end: number}[] | null>}
 */
export async function synthesizeSpeech(text, outFile) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenLabsVoice)}/with-timestamps?output_format=mp3_44100_128`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': config.elevenLabsKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: config.elevenLabsModel }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    if (response.status === 401) {
      throw new UserError(`ElevenLabs rejected the API key or ran out of credits: ${detail}`);
    }
    throw new UserError(`ElevenLabs error ${response.status}: ${detail}`);
  }
  const data = await response.json();
  await fs.writeFile(outFile, Buffer.from(data.audio_base64, 'base64'));
  return wordsFromAlignment(data.alignment ?? data.normalized_alignment);
}

/** Group ElevenLabs per-character timings into words. */
export function wordsFromAlignment(alignment) {
  if (!alignment?.characters?.length) return null;
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const words = [];
  let current = null;
  for (let i = 0; i < characters.length; i++) {
    if (/\s/.test(characters[i])) {
      current = null;
      continue;
    }
    if (!current) {
      current = { word: '', start: starts[i], end: ends[i] };
      words.push(current);
    }
    current.word += characters[i];
    current.end = ends[i];
  }
  return words.length ? words : null;
}
