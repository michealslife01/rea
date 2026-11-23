import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config, UserError } from './config.js';

async function searchPexels(query, orientation) {
  const url = new URL('https://api.pexels.com/videos/search');
  url.search = new URLSearchParams({ query, orientation, per_page: '15' }).toString();
  const response = await fetch(url, { headers: { Authorization: config.pexelsKey } });
  if (response.status === 401 || response.status === 403) {
    throw new UserError('Pexels rejected the API key. Check PEXELS_API_KEY in your .env file.');
  }
  if (!response.ok) throw new Error(`Pexels search failed with status ${response.status}`);
  const data = await response.json();
  return data.videos ?? [];
}

/** The smallest MP4 rendition that is still at least as large as the target frame. */
function pickFile(video, width, height) {
  const files = (video.video_files ?? []).filter((file) => file.file_type === 'video/mp4' && file.width && file.height);
  if (!files.length) return null;
  const bigEnough = files.filter((file) => file.width >= width * 0.66 && file.height >= height * 0.66);
  const pool = bigEnough.length ? bigEnough : files;
  return pool.sort((a, b) => (bigEnough.length ? a.width * a.height - b.width * b.height : b.width * b.height - a.width * a.height))[0];
}

/**
 * Download a stock clip that matches `query`. Returns null when nothing fits,
 * so the caller can fall back to a plain background.
 */
export async function downloadStockClip(query, format, outFile, usedIds) {
  // Try the full query, then a shorter one, before giving up.
  const queries = [query, query.split(/\s+/).slice(0, 2).join(' ')].filter((q, i, all) => q && all.indexOf(q) === i);
  for (const q of queries) {
    const videos = await searchPexels(q, format.orientation);
    const fresh = videos.filter((video) => !usedIds.has(video.id));
    for (const video of fresh.length ? fresh : videos) {
      const file = pickFile(video, format.width, format.height);
      if (!file) continue;
      const response = await fetch(file.link);
      if (!response.ok || !response.body) continue;
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(outFile));
      usedIds.add(video.id);
      return { id: video.id, url: video.url, author: video.user?.name };
    }
  }
  return null;
}
