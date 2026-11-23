const WHITE = '&H00FFFFFF&';
const HIGHLIGHT = '&H0000E5FF&'; // ASS colours are BGR: this is yellow (#FFE500)
const MAX_WORDS_PER_LINE = 3;
const MAX_CHARS_PER_LINE = 16;

/**
 * Spread words across `duration` seconds in proportion to their length,
 * with extra time after punctuation. Used when the voice gives no timings.
 */
export function estimateWordTimings(text, duration) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const weights = words.map((word) => word.length + 2 + (/[.!?]$/.test(word) ? 6 : /[,;:]$/.test(word) ? 3 : 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const lead = Math.min(0.15, duration * 0.05);
  const usable = Math.max(0.1, duration - lead * 2);
  let time = lead;
  return words.map((word, i) => {
    const length = (weights[i] / total) * usable;
    const timing = { word, start: time, end: time + length };
    time += length;
    return timing;
  });
}

/** Split timed words into short caption lines. */
export function groupIntoLines(words) {
  const lines = [];
  let line = [];
  for (const word of words) {
    const chars = line.reduce((sum, w) => sum + w.word.length + 1, 0) + word.word.length;
    if (line.length && (line.length >= MAX_WORDS_PER_LINE || chars > MAX_CHARS_PER_LINE)) {
      lines.push(line);
      line = [];
    }
    line.push(word);
    if (/[.!?]$/.test(word.word)) {
      lines.push(line);
      line = [];
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

function assTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

// Braces and backslashes are ASS markup; drop them from spoken words.
const clean = (word) => word.replace(/[{}\\]/g, '');

/**
 * Build an ASS subtitle file that shows a few words at a time and
 * highlights the word being spoken.
 */
export function buildAss(words, { width, height, duration }) {
  const fontSize = Math.round(Math.min(width, height) * 0.09);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,${fontSize},${WHITE},${WHITE},&H00000000&,&H80000000&,-1,0,0,0,100,100,0,0,1,${Math.round(fontSize / 12)},2,2,${Math.round(width * 0.08)},${Math.round(width * 0.08)},${Math.round(height * 0.22)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = [];
  const lines = groupIntoLines(words);
  lines.forEach((line, lineIndex) => {
    const nextLineStart = lines[lineIndex + 1]?.[0].start;
    const lineEnd = Math.min(nextLineStart ?? duration, line.at(-1).end + 0.6, duration);
    line.forEach((word, i) => {
      const start = word.start;
      const end = i + 1 < line.length ? line[i + 1].start : lineEnd;
      if (end <= start) return;
      const text = line
        .map((w, j) => (j === i ? `{\\c${HIGHLIGHT}}${clean(w.word)}{\\c${WHITE}}` : clean(w.word)))
        .join(' ');
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${text}`);
    });
  });
  return header + events.join('\n') + '\n';
}
