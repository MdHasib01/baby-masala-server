import { POST_TOPICS } from '../../models/index.js';
import { canonBn } from '../../utils/bnText.js';
import { AgentError, generateText } from './nodeAgentClient.js';

/**
 * Writes posts and comments for labeled AI personas through node-agent.
 * Everything a persona publishes is generated here, behind one safety brief.
 */

const MAX_POST_CHARS = 1500;
const MAX_COMMENT_CHARS = 600;
const DISCLAIMER = 'এটি সাধারণ তথ্য, চিকিৎসকের পরামর্শের বিকল্প নয়।';

const SAFETY_BRIEF = `You write for the community feed of "Baby Care by Baby Masala", a Bangladeshi parenting app.
You are an AI-generated community member. Users can see it: your name ends with "(AI)" and has an AI badge.

Hard rules:
- Write natural, warm, simple Bangla (Bengali script). No English except common words like "ORS".
- You may write in your character's own voice, name and personality. If asked, say you are AI.
- Never claim to be a real human, a doctor or a nurse. Never invent stories about your own baby's illness,
  medicines, treatments or results, and never give testimonials ("I used X and it worked"). For experience,
  speak generally: "অনেক মা জানান...".
- No diagnosis. Never name medicines, doses, supplements or home remedies for an illness.
- For fever in a baby under 3 months, fever over 3 days, breathing trouble, rash with fever, dehydration
  (no wet nappy, sunken eyes), seizures, refusing feeds, blood in stool, or anything that sounds urgent:
  say kindly but clearly to see a doctor / go to the hospital now.
- Feeding advice follows WHO/UNICEF: exclusive breastfeeding to 6 months, complementary food from 6 months,
  no honey before 1 year, no cow's milk as main drink before 1 year, no added salt/sugar before 1 year.
- Do not sell. Do not mention prices, brands, the shop or Baby Masala products.
- Be respectful of every family's choices; no shaming, no religion or politics.
- No hashtags, no markdown, no emojis beyond at most two simple ones.
- Reply with JSON only, no code fences, no text before or after it.`;

function personaBrief(persona) {
  return `Your persona: "${persona.name}". ${persona.persona?.voice || 'Friendly, calm and practical.'}`;
}

/** Pull the first JSON object out of CLI output (which may add chatter or code fences). */
export function parseJsonObject(output) {
  const text = String(output ?? '').replace(/```(?:json)?/gi, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new AgentError('transient', `AI answer had no JSON: ${text.slice(0, 160)}`);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AgentError('transient', `AI answer was not valid JSON: ${text.slice(start, start + 160)}`);
  }
}

/** Strip markdown, collapse whitespace and enforce length. */
function cleanText(value, max, field, min = 20) {
  const text = canonBn(String(value ?? ''))
    .replace(/\*\*|__|^#+\s*/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length < min) throw new AgentError('transient', `AI ${field} was empty or too short`);
  if (text.length > max) {
    const cut = text.slice(0, max);
    const lastStop = Math.max(cut.lastIndexOf('।'), cut.lastIndexOf('?'), cut.lastIndexOf('\n'));
    return (lastStop > max * 0.6 ? cut.slice(0, lastStop + 1) : cut).trim();
  }
  return text;
}

const withDisclaimer = (text) => (text.includes('চিকিৎসকের পরামর্শের বিকল্প নয়') ? text : `${text}\n\n${DISCLAIMER}`);

const POST_KINDS = [
  'a short practical tip, then one question inviting mothers to share what worked for them',
  'a simple question or poll-style prompt (2-4 options written as lines) that mothers can answer in comments',
  'a myth vs. fact explainer about one common belief in Bangladesh',
  'an encouraging message for tired parents with one small self-care idea, ending with a question',
];

const PHOTO_INSTRUCTIONS = `
This post will have one photo. Write the text so it fits the photo, and add "photo": an English description
(1-3 sentences) of a realistic everyday photo to go with it. Good subjects: homemade baby food in a bowl or the
ingredients for it, a mother and baby playing or reading, baby clothes or simple toys, a safe sleep space (baby on
the back, empty cot), hands preparing food, a family moment at home or outdoors in Bangladesh. Describe the subject,
place and mood concretely. Never: a sick, hurt, crying-in-distress or undressed child, medicines, hospitals,
products or brand packaging, text in the image.
`;

/**
 * A new feed post on `topic` (one of POST_TOPICS). `recent` are the persona's
 * last few post texts, so it does not repeat itself.
 */
export async function writePost(persona, topic, recent = [], { withImage = false, ai = {} } = {}) {
  const kind = POST_KINDS[Math.floor(Math.random() * POST_KINDS.length)];
  const prompt = `Write one community feed post on the topic "${topic}" (topics: ${POST_TOPICS.join(', ')}).
Make it ${kind}. Today is ${new Date().toISOString().slice(0, 10)}; you may mention the season in Bangladesh.
Length: 300-900 Bangla characters. Do not start with a greeting to a named person.
${recent.length ? `Do NOT repeat these recent posts of yours:\n${recent.map((t) => `- ${t.slice(0, 140)}`).join('\n')}` : ''}

${withImage ? PHOTO_INSTRUCTIONS : ''}
Reply as JSON: {"topic": "${topic}", "content": "<the post>"${withImage ? ', "photo": "<English description of the photo>"' : ''}}`;

  const job = await generateText({ prompt, context: `${SAFETY_BRIEF}\n\n${personaBrief(persona)}`, ...ai });
  const data = parseJsonObject(job.output);
  const chosen = canonBn(String(data.topic ?? topic).trim());
  return {
    topic: POST_TOPICS.includes(chosen) ? chosen : topic,
    content: withDisclaimer(cleanText(data.content, MAX_POST_CHARS, 'post')),
    photo: withImage ? String(data.photo ?? '').trim().slice(0, 800) : '',
  };
}

/** A helpful first reply to a real member's post that nobody has answered yet. */
export async function writeComment(persona, post, comments = [], { ai = {} } = {}) {
  const thread = comments
    .slice(-5)
    .map((c) => `- ${c.authorName}: ${String(c.content).slice(0, 200)}`)
    .join('\n');
  const prompt = `A member posted this in the "${post.topic}" section:
"""
${String(post.content).slice(0, 2500)}
"""
${post.mediaUrl ? '(The post also has a photo/video you cannot see; do not describe it.)\n' : ''}${thread ? `Existing comments:\n${thread}\n` : ''}
Write one warm, helpful comment reply (150-450 Bangla characters). Acknowledge what they shared,
give 1-2 practical, safe suggestions or answer their question, and if anything sounds like a health
problem, gently advise seeing a doctor. Address them as "আপু" or without a name. Do not ask for personal details.

Reply as JSON: {"content": "<the comment>"}`;

  const job = await generateText({ prompt, context: `${SAFETY_BRIEF}\n\n${personaBrief(persona)}`, ...ai });
  const data = parseJsonObject(job.output);
  return { content: withDisclaimer(cleanText(data.content, MAX_COMMENT_CHARS, 'comment')) };
}

const HEALTH_WORDS = /ডাক্তার|চিকিৎসক|জ্বর|ওষুধ|হাসপাতাল|অসুস্থ|ডায়রিয়া|পাতলা পায়খানা|বমি|কাশি|শ্বাস|র‍্যাশ|ফুসকুড়ি|ইনফেকশন|ব্যথা/;

/**
 * How long each comment in a batch is, so a thread reads like real members:
 * mostly quick reactions and one-liners, now and then a longer one.
 * `max` is a hard cut in characters.
 */
export const COMMENT_LENGTHS = {
  reaction: {
    max: 40,
    brief: '1-3 words only, a quick reaction, e.g. "মাশাআল্লাহ ❤️", "একদম ঠিক", "সুন্দর বলেছেন আপু", "দোয়া রইলো", "😊👍"',
  },
  short: { max: 110, brief: 'one short casual line, 4-15 words, like a quick phone comment' },
  medium: { max: 230, brief: '1-2 sentences, about 60-200 Bangla characters' },
  long: { max: 420, brief: '2-4 sentences, about 200-380 Bangla characters, sharing one practical idea or a question' },
};
export const COMMENT_LENGTH_KEYS = Object.keys(COMMENT_LENGTHS);

/**
 * Several comments on one post in a single AI call, one per persona in
 * `personas` (different labeled AI users); `lengths[i]` is the length style
 * (COMMENT_LENGTHS key) for personas[i]. Returns [{ persona, content, length }];
 * comments that come back empty or broken are dropped.
 */
export async function writeCommentBatch(post, comments, personas, { ai = {}, lengths = [] } = {}) {
  const styleOf = (i) => (COMMENT_LENGTHS[lengths[i]] ? lengths[i] : 'medium');
  const thread = comments
    .slice(-8)
    .map((c) => `- ${c.authorName}: ${String(c.content).slice(0, 200)}`)
    .join('\n');
  const cast = personas
    .map(
      (p, i) =>
        `${i + 1}. "${p.name}" — LENGTH: ${COMMENT_LENGTHS[styleOf(i)].brief}. Voice: ${String(
          p.persona?.voice || 'Friendly, calm and practical.'
        ).slice(0, 200)}`
    )
    .join('\n');

  const prompt = `This post is in the "${post.topic}" section of the community feed, written by ${post.authorName}:
"""
${String(post.content).slice(0, 2500)}
"""
${post.mediaUrl ? '(The post also has a photo/video you cannot see; do not describe it.)\n' : ''}${thread ? `Existing comments (do not repeat them):\n${thread}\n` : ''}
Write ${personas.length} separate comments on this post, one by each of these community members, in this order.
Follow each member's LENGTH exactly - the mix of very short and longer comments is what makes the thread look natural:
${cast}

Make them read like real Bangladeshi mothers typing on a phone in a Facebook group:
- Casual everyday Bangla; short ones can be just a word or two, an emoji, "আমিন", "ইনশাআল্লাহ", "সেম অবস্থা আপু 😅", etc.
- Vary how they start and end. Do not start every comment with "আপু", do not all thank the author,
  do not all give advice, and do not repeat the same phrases or structure.
- Mix the kinds: quick reactions, agreement, a short question, encouragement, and only sometimes a practical idea.
- No formal or textbook language, no lists, no summarising the post back, no disclaimers.
- React to the post itself; you may agree with an earlier comment, but do not address each other by name.
- Do not ask for personal details. If something sounds like a real health problem, a longer comment may say to see a doctor.

Reply as JSON: {"comments": [{"member": 1, "content": "<comment>"}, ...]}`;

  const job = await generateText({ prompt, context: SAFETY_BRIEF, ...ai });
  const data = parseJsonObject(job.output);
  const list = Array.isArray(data.comments) ? data.comments : [];

  const used = new Set();
  const out = [];
  for (const item of list) {
    let index = Number(item?.member) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= personas.length || used.has(index)) {
      index = personas.findIndex((_, i) => !used.has(i));
    }
    if (index === -1) break;
    const length = styleOf(index);
    try {
      const text = cleanText(item?.content, COMMENT_LENGTHS[length].max, 'comment', 1);
      used.add(index);
      // The full disclaimer only on longer health advice; on a one-liner it gives the bot away.
      const advice = text.length > 120 && HEALTH_WORDS.test(text);
      out.push({ persona: personas[index], content: advice ? withDisclaimer(text) : text, length });
    } catch {
      // empty: skip this one
    }
  }
  if (!out.length) throw new AgentError('transient', 'AI comment batch had no usable comments');
  return out;
}
