import { POST_TOPICS } from '../../models/index.js';
import { canonBn } from '../../utils/bnText.js';
import { cloudinaryEnabled, uploadDataUrl } from '../cloudinary.js';
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
export async function generateProfile({ existingNames = [], guidance = '' } = {}) {
  const taken = new Set(existingNames.map((n) => stripAiLabel(n)));
  const avoid = [...taken].slice(-80);

  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = `Create one new member profile.
${guidance ? `Admin guidance for this profile: ${guidance}\n` : ''}${avoid.length ? `These names are already taken, use a clearly different one:\n${avoid.join(', ')}\n` : ''}
Reply as JSON:
{
  "name": "<Bangla full name>",
  "location": "<Bangladeshi district or city, in Bangla>",
  "bio": "<1-2 short Bangla sentences: her stage of parenting and interests; no medical claims>",
  "voice": "<English, 1-3 sentences: how she writes - tone, sentence length, favourite subjects>",
  "focusTopics": ["<1-2 of: ${POST_TOPICS.join(', ')}>"],
  "photoPrompt": "<English, one sentence describing her portrait: approximate age, face shape, hair or hijab, clothing (saree / salwar kameez / kurti, colours), expression and an everyday Bangladeshi home or outdoor background>"
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
      photoPrompt: String(data.photoPrompt ?? '').trim().slice(0, 600),
    };
  }
  throw new AgentError('transient', 'AI kept suggesting a name that is already used');
}

const PORTRAIT_WRAPPER = (description) =>
  `Create a photorealistic smartphone profile photo of a fictional person (she does not exist).
${description || 'A Bangladeshi woman in her late twenties wearing a salwar kameez, smiling softly, at home.'}
Square 1:1, head and shoulders, natural daylight, casual and authentic like a real social-media profile picture.
Must not resemble any real or famous person. No text, no logo, no watermark, no children in the photo.
Save it as a single PNG or JPEG file.`;

/** Generates a portrait and returns its Cloudinary https URL. */
export async function generatePortrait(photoPrompt) {
  if (!cloudinaryEnabled()) {
    throw new AgentError('fatal', 'Cloudinary is not configured (CLOUDINARY_URL in backend/.env), so portraits cannot be stored');
  }
  const { url } = await generateImage({ prompt: PORTRAIT_WRAPPER(photoPrompt) });
  const { buffer, mimeType } = await download(url);
  if (!/^image\//.test(mimeType)) throw new AgentError('transient', `node-agent output is not an image (${mimeType})`);
  return uploadDataUrl(`data:${mimeType};base64,${buffer.toString('base64')}`);
}
