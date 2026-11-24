import Anthropic from '@anthropic-ai/sdk';
import { config, UserError } from './config.js';

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          narration: { type: 'string' },
          visual: { type: 'string' },
        },
        required: ['narration', 'visual'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'scenes'],
  additionalProperties: false,
};

const SYSTEM = `You write scripts for short narrated social videos (TikTok, Reels, Shorts).

The script is read aloud by a text-to-speech voice over stock footage, with captions on screen.
- Open with a hook in the first scene that makes the viewer keep watching.
- Each scene is one or two short spoken sentences. Write only what the narrator says: no stage directions, emojis, hashtags, or speaker labels.
- Spell out numbers and symbols the way they should be spoken.
- End with a clear payoff or call to action.
- For each scene, "visual" is a 2-4 word search query for stock footage that a stock site is likely to have: concrete and filmable (for example "city traffic at night", "hands typing laptop"). Never use names of people, brands, or on-screen text.
- "title" is a short title for the video.`;

let client;

/**
 * Ask Claude for a scene-by-scene script.
 * @returns {Promise<{title: string, scenes: {narration: string, visual: string}[]}>}
 */
export async function writeScript({ prompt, seconds, tone }) {
  if (!config.hasClaude) {
    throw new UserError('The app has no Claude API key. Add ANTHROPIC_API_KEY to the .env file in the vidgen folder, save it, then restart the app (Ctrl+C, then npm start).');
  }
  client ??= new Anthropic();
  const words = Math.round(seconds * 2.5);
  const sceneCount = Math.max(3, Math.round(seconds / 5));

  let response;
  try {
    response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      // If the model declines a request, the API retries it on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SCRIPT_SCHEMA },
      },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Video idea: ${prompt}\n\nTone: ${tone}\nLength: about ${seconds} seconds (about ${words} spoken words in total), split into about ${sceneCount} scenes.`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new UserError('Claude rejected the API key. Check ANTHROPIC_API_KEY in your .env file and restart the app.');
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new UserError('Claude is rate limiting this key. Wait a minute and try again.');
    }
    if (error instanceof Anthropic.APIError) {
      throw new UserError(`Claude API error ${error.status ?? ''}: ${error.message}`);
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') {
    throw new UserError('Claude declined to write a script for this idea. Try rewording it.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new UserError('The script came back incomplete. Try a shorter video.');
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  const script = JSON.parse(text);
  return {
    title: String(script.title).trim(),
    scenes: script.scenes
      .map((scene) => ({ narration: scene.narration.trim(), visual: scene.visual.trim() }))
      .filter((scene) => scene.narration),
  };
}
