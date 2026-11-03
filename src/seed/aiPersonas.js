/**
 * Creates (or refreshes) the default labeled AI personas. Safe to re-run.
 *
 *   npm run ai:personas
 *
 * Each persona's name ends with "(AI)", its bio says it is an AI, and its
 * avatar is an icon, never a photo of a real person. Edit or pause them later in
 * the web admin (Admin → AI ইউজার).
 */
import { connectDB, disconnectDB } from '../config/db.js';
import { env, requireEnv } from '../config/env.js';
import { User } from '../models/index.js';
import { AI_CONTACT_DOMAIN, labeledBio, labeledName } from '../services/ai/personas.js';

const icon = (seed, bg) => `https://api.dicebear.com/9.x/icons/png?seed=${encodeURIComponent(seed)}&backgroundColor=${bg}&size=150`;

const DEFAULT_PERSONAS = [
  {
    slug: 'pushti',
    name: 'পুষ্টি আপা',
    avatar: icon('pushti-apa', 'fde68a'),
    bio: 'শিশুর খাবার ও পুষ্টি নিয়ে সহজ টিপস দিই।',
    voice:
      'A cheerful, practical nutrition guide for babies 0-2 years. Talks about breastfeeding, first foods from 6 months, ' +
      'simple Bangladeshi home foods (khichuri, suji, mashed fruit), textures and food safety.',
    focusTopics: ['খাবার'],
  },
  {
    slug: 'ghum',
    name: 'ঘুম সহকারী',
    avatar: icon('ghum-sohokari', 'c7d2fe'),
    bio: 'শিশুর ঘুমের রুটিন ও শান্ত রাত নিয়ে কথা বলি।',
    voice:
      'A calm, gentle sleep guide. Talks about safe sleep (back to sleep, clear cot), bedtime routines, naps by age, ' +
      'night wakings and supporting exhausted parents without judgement.',
    focusTopics: ['ঘুম'],
  },
  {
    slug: 'bikash',
    name: 'বিকাশ সঙ্গী',
    avatar: icon('bikash-shongi', 'bbf7d0'),
    bio: 'শিশুর বেড়ে ওঠা, খেলা আর মায়েদের মনের যত্ন নিয়ে আছি।',
    voice:
      'An encouraging development and wellbeing companion. Talks about milestones by age (always "every child is different"), ' +
      'play ideas with household items, talking and reading to babies, and the mother\'s own rest and mental health.',
    focusTopics: ['বিকাশ', 'মায়ের গল্প'],
  },
];

async function main() {
  requireEnv('MONGODB_URI');
  await connectDB(env.mongodbUri);

  for (const p of DEFAULT_PERSONAS) {
    const contact = `${p.slug}@${AI_CONTACT_DOMAIN}`;
    const fields = {
      name: labeledName(p.name),
      avatar: p.avatar,
      bio: labeledBio(p.bio),
      isAiPersona: true,
      isVerified: true,
      isMember: true,
      'persona.voice': p.voice,
      'persona.focusTopics': p.focusTopics,
      notificationPrefs: { push: false, sms: false, email: false, communityAlerts: false },
    };
    const existing = await User.findOne({ contact });
    if (existing) {
      // Keep admin edits to active/lastPostAt; refresh the label, bio and voice.
      existing.set(fields);
      await existing.save();
      console.log(`[ai:personas] updated ${existing.name}`);
    } else {
      const created = await User.create({
        contact,
        contactMethod: 'email',
        name: fields.name,
        avatar: fields.avatar,
        bio: fields.bio,
        isAiPersona: true,
        isVerified: true,
        isMember: true,
        persona: { voice: p.voice, focusTopics: p.focusTopics, active: true },
        notificationPrefs: fields.notificationPrefs,
      });
      console.log(`[ai:personas] created ${created.name} (${created._id})`);
    }
  }
}

main()
  .catch((err) => {
    console.error('[ai:personas] failed:', err);
    process.exitCode = 1;
  })
  .finally(disconnectDB);
