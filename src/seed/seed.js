/**
 * Seeds MongoDB with the frontend's original mock data.
 *
 *   npm run seed         – inserts the catalog (products, recipes, gifts, contests, doctors)
 *                          if missing; never overwrites existing data
 *   npm run seed:demo    – also creates the demo admin, demo mothers and the sample feed.
 *                          Local development only: never run this against production.
 *   npm run seed:reset   – drops the database first, then seeds the catalog from scratch
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { env, requireEnv } from '../config/env.js';
import {
  Comment,
  Contest,
  Doctor,
  Gift,
  Notification,
  Order,
  OWNED,
  Post,
  Product,
  Recipe,
  RewardTransaction,
  User,
} from '../models/index.js';
import { parseBnTime } from '../utils/bnTime.js';
import { seedData } from './loadSeedData.js';

const DEMO_CONTACT = '01712345678';

// The mothers shown on the original hard-coded leaderboard and in the feed.
const COMMUNITY_MEMBERS = [
  { name: 'সাবিহা সুলতানা', photo: 'photo-1534528741775-53994a69daeb', earned: 1250, slug: 'sabiha' },
  { name: 'নুসরাত জাহান', photo: 'photo-1517841905240-472988babdf9', earned: 980, slug: 'nusrat' },
  { name: 'আয়েশা সিদ্দিকা', photo: 'photo-1494790108377-be9c29b29330', earned: 850, slug: 'ayesha' },
  { name: 'ফারজানা আক্তার', photo: 'photo-1524504388940-b1c1722653e1', earned: 520, slug: 'farzana' },
  { name: 'নাজনীন আকতার', photo: 'photo-1544005313-94ddf0286df2', earned: 410, slug: 'naznin' },
];

const avatarUrl = (photo) => `https://images.unsplash.com/${photo}?w=150&auto=format&fit=crop&q=80`;
const withoutId = ({ id, ...rest }) => rest;

/** Inserts documents whose _id is missing; leaves existing ones untouched. */
async function insertMissing(Model, docs) {
  if (!docs.length) return 0;
  const res = await Model.bulkWrite(
    docs.map((doc) => ({
      updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true },
    }))
  );
  return res.upsertedCount;
}

async function seedCatalog() {
  const counts = {
    products: await insertMissing(Product, seedData.products.map((p) => ({ _id: p.id, ...withoutId(p) }))),
    recipes: await insertMissing(
      Recipe,
      seedData.recipes.map(({ saved, ...r }) => ({ _id: r.id, ...withoutId(r), savedBy: [] }))
    ),
    gifts: await insertMissing(Gift, seedData.gifts.map((g) => ({ _id: g.id, ...withoutId(g) }))),
    contests: await insertMissing(Contest, seedData.contests.map((c) => ({ _id: c.id, ...withoutId(c) }))),
    doctors: await insertMissing(Doctor, seedData.doctors.map((d) => ({ _id: d.id, ...withoutId(d) }))),
  };
  console.log('[seed] catalog inserted:', counts);
}

async function seedCommunityMembers() {
  const byName = new Map();
  for (const m of COMMUNITY_MEMBERS) {
    const contact = `${m.slug}@community.babycare.demo`;
    let user = await User.findOne({ contact });
    if (!user) {
      user = await User.create({
        name: m.name,
        contact,
        contactMethod: 'email',
        isVerified: true,
        isMember: true,
        avatar: avatarUrl(m.photo),
        earnedPoints: m.earned,
      });
      await RewardTransaction.create({
        user: user._id,
        description: 'পূর্ববর্তী কার্যক্রম থেকে অর্জিত পয়েন্ট',
        points: m.earned,
        type: 'earn',
        source: 'seed',
      });
    }
    byName.set(m.name, user);
  }
  console.log(`[seed] community members ready: ${byName.size}`);
  return byName;
}

async function seedDemoUser() {
  const existing = await User.findOne({ contact: DEMO_CONTACT });
  if (existing) {
    console.log(`[seed] demo user ${DEMO_CONTACT} already exists — skipped`);
    return existing;
  }

  const u = seedData.user;
  const earnedPoints = seedData.rewardTx.filter((t) => t.type === 'earn').reduce((sum, t) => sum + t.points, 0);
  const user = await User.create({
    name: u.name,
    contact: DEMO_CONTACT,
    contactMethod: 'whatsapp',
    role: 'admin',
    isVerified: true,
    isMember: u.isMember,
    membershipExpiry: u.membershipExpiry,
    couponUsed: u.couponUsed,
    avatar: u.avatar,
    addresses: u.addresses,
    notificationPrefs: u.notificationPrefs,
    privacySettings: u.privacySettings,
    earnedPoints,
  });
  const owner = user._id;

  const owned = (key, items) =>
    OWNED[key].model.insertMany(items.map((item, position) => ({ ...withoutId(item), clientId: item.id, owner, position })));

  await Promise.all([
    owned('children', seedData.children),
    owned('friends', seedData.friends),
    owned('conversations', seedData.conversations),
    owned('messages', seedData.messages),
    owned('doctorQuestions', seedData.doctorQuestions),
    Order.insertMany(
      seedData.orders.map((o) => ({
        _id: o.id,
        user: owner,
        items: o.items,
        subtotal: o.items.reduce((sum, i) => sum + i.product.price * i.quantity, 0),
        deliveryCharge: 0,
        totalAmount: o.totalAmount,
        status: o.status,
        shippingAddress: o.shippingAddress,
        pointsEarned: o.pointsEarned,
        createdAt: parseBnTime(o.createdAt),
      }))
    ),
    RewardTransaction.insertMany(
      seedData.rewardTx.map((t) => ({
        user: owner,
        description: t.description,
        points: t.points,
        type: t.type,
        source: 'seed',
        createdAt: parseBnTime(t.date),
      }))
    ),
    Notification.insertMany(
      seedData.notifications.map((n) => ({
        owner,
        title: n.title,
        message: n.message,
        read: n.read,
        type: n.type,
        createdAt: parseBnTime(n.time),
      }))
    ),
    Recipe.updateMany(
      { _id: { $in: seedData.recipes.filter((r) => r.saved).map((r) => r.id) } },
      { $addToSet: { savedBy: owner } }
    ),
  ]);

  console.log(`[seed] demo user created: ${u.name} (${DEMO_CONTACT}, admin, ${earnedPoints} points)`);
  return user;
}

async function seedFeed(membersByName, demoUser) {
  if ((await Post.estimatedDocumentCount()) > 0) {
    console.log('[seed] posts already exist — feed skipped');
    return;
  }
  const authorOf = (name) => membersByName.get(name)?._id;
  const demoId = demoUser._id;

  await Post.insertMany(
    seedData.posts.map((p) => ({
      _id: p.id,
      author: authorOf(p.authorName),
      authorName: p.authorName,
      authorAvatar: p.authorAvatar,
      isVerifiedBuyer: p.isVerifiedBuyer,
      topic: p.topic,
      content: p.content,
      mediaUrl: p.mediaUrl,
      mediaType: p.mediaType,
      status: p.status,
      likes: p.likes,
      likedBy: p.likedByMe ? [demoId] : [],
      reactionRewardedTo: p.likedByMe ? [demoId] : [],
      savedBy: p.savedByMe ? [demoId] : [],
      commentsCount: p.commentsCount,
      createdAt: parseBnTime(p.createdAt),
    }))
  );
  await Comment.insertMany(
    seedData.comments.map((c) => ({
      _id: c.id,
      post: c.postId,
      author: authorOf(c.authorName),
      authorName: c.authorName,
      authorAvatar: c.authorAvatar,
      content: c.content,
      likes: c.likes,
      createdAt: parseBnTime(c.createdAt),
    }))
  );
  console.log(`[seed] feed inserted: ${seedData.posts.length} posts, ${seedData.comments.length} comments`);
}

async function main() {
  requireEnv('MONGODB_URI');
  await connectDB(env.mongodbUri);

  if (process.argv.includes('--reset')) {
    await mongoose.connection.dropDatabase();
    console.log('[seed] database dropped');
  }
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

  await seedCatalog();
  if (process.argv.includes('--demo')) {
    const members = await seedCommunityMembers();
    const demoUser = await seedDemoUser();
    await seedFeed(members, demoUser);
  }
  console.log('[seed] done');
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(disconnectDB);
