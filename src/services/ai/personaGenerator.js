import { POST_TOPICS } from '../../models/index.js';
import { canonBn } from '../../utils/bnText.js';
import { cloudinaryEnabled, uploadDataUrl, withTransform } from '../cloudinary.js';
import { describePortrait, randomIdentity } from './looks.js';
import { AgentError, download, generateImage, generateText } from './nodeAgentClient.js';
import { parseJsonObject } from './personaWriter.js';
import { stripAiLabel } from './personas.js';

/**
 * Generates the profile of a new AI community member: a realistic Bangladeshi
 * name, location, bio, writing voice and a photorealistic portrait of a
 * fictional person. The caller adds the "(AI)" label (labeledName / labeledBio).
 */

const PROFILE_BRIEF = `You create fictional member profiles for "Baby Care by Baby Masala", a Bangladeshi parenting app.
These profiles are shown with an "(AI)" tag and an AI badge; they are AI characters, not real people.
- The person is a fictional Bangladeshi mother (age 22-40) of a baby or toddler.
- Use a common, realistic Bangladeshi Muslim or Hindu female full name in Bangla script, 2-3 words.
  Never use the name of a celebrity, politician or other well-known person.
- Vary everything between profiles: names, districts, ages, family situation, interests, writing style.
- No phone numbers, emails, addresses, workplaces or other personal identifiers.
- Reply with JSON only, no code fences.`;

const clip = (value, max) => canonBn(String(value ?? '').trim()).slice(0, max);

/**
 * One profile. `existingNames` (already in use, without the AI tag) must not be
 * repeated; `guidance` is the admin's optional steer, e.g. "চট্টগ্রামের মায়েরা".
 */
export async function generateProfile({ existingNames = [], guidance = '', look = randomIdentity() } = {}) {
  const taken = new Set(existingNames.map((n) => stripAiLabel(n)));
  const avoid = [...taken].slice(-80);

  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = `Create one new member profile.
She is a ${look.religion} woman, about ${look.age} years old, mother of a child aged ${look.childAge}; the name, bio and voice must fit that.
${guidance ? `Admin guidance for this profile: ${guidance}\n` : ''}${avoid.length ? `These names are already taken, use a clearly different one:\n${avoid.join(', ')}\n` : ''}
Reply as JSON:
{
  "name": "<Bangla full name>",
  "location": "<Bangladeshi district or city, in Bangla>",
  "bio": "<1-2 short Bangla sentences: her stage of parenting and interests; no medical claims>",
  "voice": "<English, 1-3 sentences: how she writes - tone, sentence length, favourite subjects>",
  "focusTopics": ["<1-2 of: ${POST_TOPICS.join(', ')}>"]
}`;
    const job = await generateText({ prompt, context: PROFILE_BRIEF });
    const data = parseJsonObject(job.output);

    const name = stripAiLabel(clip(data.name, 50));
    if (name.length < 3) throw new AgentError('transient', 'AI profile had no name');
    if (taken.has(name)) {
      avoid.push(name);
      continue;
    }
    const focusTopics = [...new Set((Array.isArray(data.focusTopics) ? data.focusTopics : []).map((t) => canonBn(String(t).trim())))].filter(
      (t) => POST_TOPICS.includes(t)
    );
    return {
      name,
      location: clip(data.location, 80),
      bio: clip(data.bio, 300),
      voice: String(data.voice ?? '').trim().slice(0, 800),
      focusTopics: focusTopics.length ? focusTopics : [POST_TOPICS[Math.floor(Math.random() * POST_TOPICS.length)]],
      look,
    };
  }
  throw new AgentError('transient', 'AI kept suggesting a name that is already used');
}

const PORTRAIT_WRAPPER = (description) =>
  `Create a photorealistic smartphone profile photo of a fictional person (she does not exist).
${description}
Square 1:1. Casual and authentic like a real social-media profile picture, not a studio or stock photo.
Must not resemble any real or famous person. If a child is in the photo, the child is fictional, fully clothed and safe.
No text, no logo, no watermark. Save it as a single PNG or JPEG file.`;

const POST_PHOTO_WRAPPER = (description, style) =>
  `Create a photorealistic smartphone photo for a parenting community post in Bangladesh.
${description}
Vertical 4:5 portrait format (1080x1350), like a Facebook feed photo; keep the main subject centred with a little space around it.
Style: ${style}. Looks like an ordinary person's phone photo, not a stock or studio photo.
Any people are fictional and must not resemble a real or famous person; children are fully clothed and safe.
No text, no logo, no brand names or packaging, no medicines. Save it as a single PNG or JPEG file.`;

/** Generates an image from a full prompt and returns its Cloudinary https URL. */
async function generateStoredImage(prompt) {
  if (!cloudinaryEnabled()) {
    throw new AgentError('fatal', 'Cloudinary is not configured (CLOUDINARY_URL in backend/.env), so images cannot be stored');
  }
  const { url } = await generateImage({ prompt });
  const { buffer, mimeType } = await download(url);
  if (!/^image\//.test(mimeType)) throw new AgentError('transient', `node-agent output is not an image (${mimeType})`);
  return uploadDataUrl(`data:${mimeType};base64,${buffer.toString('base64')}`);
}

/** A new portrait of the person described by `look` (persona.look): new outfit, place, pose and light each time. */
export async function generatePortrait(look) {
  const { description } = describePortrait(look || randomIdentity());
  return generateStoredImage(PORTRAIT_WRAPPER(description));
}

/** Facebook feed ratio: 4:5 portrait, 1080x1350. Cropped by Cloudinary (centred on the subject), so it holds whatever size the model returns. */
export const POST_PHOTO_TRANSFORM = 'c_fill,g_auto,ar_4:5,w_1080,q_auto';

/** The photo for an AI post; `description` comes from the post writer. */
export async function generatePostPhoto(description, style) {
  return withTransform(await generateStoredImage(POST_PHOTO_WRAPPER(description, style)), POST_PHOTO_TRANSFORM);
}
