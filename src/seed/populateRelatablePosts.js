import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { env, requireEnv } from '../config/env.js';
import {
  Comment,
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

const COMMUNITY_MEMBERS = [
  {
    name: 'সাবিহা সুলতানা',
    contact: 'sabiha@community.babycare.demo',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    earned: 1250,
  },
  {
    name: 'ফারজানা আক্তার',
    contact: 'farzana@community.babycare.demo',
    avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80',
    earned: 980,
  },
  {
    name: 'নুসরাত জাহান',
    contact: 'nusrat@community.babycare.demo',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    earned: 850,
  },
  {
    name: 'আয়েশা সিদ্দিকা',
    contact: 'ayesha@community.babycare.demo',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    earned: 740,
  },
  {
    name: 'তানজিলা হক',
    contact: 'tanjila@community.babycare.demo',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
    earned: 620,
  },
  {
    name: 'নাজনীন আকতার',
    contact: 'naznin@community.babycare.demo',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    earned: 510,
  },
];

async function ensureMembers() {
  const members = new Map();
  for (const m of COMMUNITY_MEMBERS) {
    let user = await User.findOne({ contact: m.contact });
    if (!user) {
      user = await User.create({
        name: m.name,
        contact: m.contact,
        contactMethod: 'email',
        isVerified: true,
        isMember: true,
        avatar: m.avatar,
        earnedPoints: m.earned,
      });
    } else {
      user.name = m.name;
      user.avatar = m.avatar;
      user.isVerified = true;
      user.isMember = true;
      await user.save();
    }
    members.set(m.name, user);
  }
  return members;
}

async function ensureReviewUser(members) {
  const reviewContact = env.reviewContact || 'playreview@babymasalabd.com';
  let user = await User.findOne({ contact: reviewContact });
  if (!user) {
    user = await User.create({
      name: 'সাদিয়া তাসনিম',
      contact: reviewContact,
      contactMethod: 'email',
      isVerified: true,
      isMember: true,
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      earnedPoints: 450,
      addresses: [
        {
          id: 'addr-1',
          title: 'বাসা',
          details: 'বাড়ি ১২, রোড ৭, ধানমন্ডি, ঢাকা ১২০৯',
          phone: '01712345678',
          isDefault: true,
        },
      ],
      notificationPrefs: { push: true, sms: false, email: true, communityAlerts: true },
      privacySettings: { shareProfile: true, showChildrenInfo: true },
    });
  } else {
    user.name = 'সাদিয়া তাসনিম';
    user.avatar = 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80';
    user.isVerified = true;
    user.isMember = true;
    if (!user.earnedPoints) user.earnedPoints = 450;
    await user.save();
  }

  // Ensure child exists for review user
  const ChildModel = OWNED.children.model;
  let child = await ChildModel.findOne({ owner: user._id });
  if (!child) {
    await ChildModel.create({
      owner: user._id,
      clientId: 'child-review-1',
      name: 'আরিয়ান রহমান',
      dob: '2024-05-15',
      allergies: 'কোনো এলার্জি নেই',
      photo: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?w=400&auto=format&fit=crop&q=80',
    });
  }

  return user;
}

const POSTS_DATA = [
  {
    id: 'post-relatable-1',
    authorName: 'সাবিহা সুলতানা',
    isVerifiedBuyer: true,
    topic: 'খাবার',
    content: 'আমার ৮ মাসের বাবুর জন্য বেবি মসলার বেবি বেসিল দিয়ে সুস্বাদু খিচুড়ি বানালাম। আলহামদুলিল্লাহ সে খুব আনন্দের সাথে চেটেপুটে খেয়েছে! আগে কিছুতেই সবজি খেতে চাইত না, এখন হার্বসের সুঘ্রাণ পেয়ে নিজেই বাটি টেনে নেয়। মায়েরা আপনাদের বাবুদের পছন্দের খিচুড়ির রেসিপি শেয়ার করবেন প্লিজ?',
    mediaUrl: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=700&auto=format&fit=crop&q=80',
    mediaType: 'image',
    minutesAgo: 15,
    likes: 42,
    reactionTypes: ['love', 'like', 'care'],
    comments: [
      {
        authorName: 'ফারজানা আক্তার',
        content: 'মাশাআল্লাহ! আমি ওরেগানো আর মিষ্টি কুমড়া দিয়ে বানাই, আমার বাবুও খুব পছন্দ করে।',
        minutesAgo: 12,
        likes: 5,
      },
      {
        authorName: 'নুসরাত জাহান',
        content: 'বেবি বেসিলটা সত্যিই অসাধারণ! খাবারের স্বাদ অনেক বেড়ে যায়।',
        minutesAgo: 8,
        likes: 3,
      },
      {
        authorName: 'তানজিলা হক',
        content: 'আপু চাল আর ডালের অনুপাত কতটুকু রাখেন?',
        minutesAgo: 5,
        likes: 2,
      },
    ],
  },
  {
    id: 'post-relatable-2',
    authorName: 'ফারজানা আক্তার',
    isVerifiedBuyer: true,
    topic: 'বিকাশ',
    content: 'আজ আমার ছোট্ট রাজপুত্র প্রথমবার একা একা কোনো সাপোর্ট ছাড়া ৩ কদম হেঁটেছে! 🥹❤️ এক বছর পূর্ণ হতে আর মাত্র ১২ দিন বাকি। এই আনন্দ ও অনুভূতি কোনো ভাষায় প্রকাশ করার মতো না। আলহামদুলিল্লাহ! মায়েরা আপনাদের বাবু প্রথম কত মাসে নিজে নিজে হাঁটা শুরু করেছিল?',
    mediaUrl: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?w=700&auto=format&fit=crop&q=80',
    mediaType: 'image',
    minutesAgo: 45,
    likes: 68,
    reactionTypes: ['love', 'love', 'care'],
    comments: [
      {
        authorName: 'সাবিহা সুলতানা',
        content: 'আলহামদুলিল্লাহ! অনেক দোয়া ও ভালোবাসা ছোট্ট সোনামণির জন্য ❤️',
        minutesAgo: 38,
        likes: 6,
      },
      {
        authorName: 'আয়েশা সিদ্দিকা',
        content: 'আমার মেয়ে ১১ মাস পূর্ণ হওয়ার দিন প্রথম পা ফেলেছিল। মুহূর্তগুলো সত্যিই অমূল্য!',
        minutesAgo: 25,
        likes: 4,
      },
    ],
  },
  {
    id: 'post-relatable-3',
    authorName: 'নুসরাত জাহান',
    isVerifiedBuyer: false,
    topic: 'ঘুম',
    content: 'শিশুর রাতের নিরবচ্ছিন্ন ও শান্তির ঘুমের জন্য আমার পরীক্ষিত কিছু টিপস:\n\n১. প্রতিদিন ঘড়ি ধরে একই সময়ে কুসুম গরম পানিতে গা মুছিয়ে হালকা ম্যাসাজ করা।\n২. ঘুমানোর আধা ঘণ্টা আগে ঘরের আলো ডিম করে কোলাহলমুক্ত রাখা।\n৩. রাতের খাবারে ওটস বা সহজপাচ্য পিউরি দেওয়া যাতে পেট ভরা থাকে।\n\nআলহামদুলিল্লাহ এখন রাতে ৪-৫ ঘণ্টা একটানা ঘুমায়। যাদের বাবু রাতে বারবার জেগে কান্না করে, তারা এই রুটিনটা অনুসরণ করে দেখতে পারেন।',
    mediaUrl: null,
    mediaType: null,
    minutesAgo: 120,
    likes: 53,
    reactionTypes: ['care', 'like', 'love'],
    comments: [
      {
        authorName: 'নাজনীন আকতার',
        content: 'অনেক ধন্যবাদ আপু টিপসগুলোর জন্য! আজ রাত থেকেই এই রুটিন শুরু করব।',
        minutesAgo: 100,
        likes: 4,
      },
      {
        authorName: 'তানজিলা হক',
        content: 'ম্যাসাজের জন্য কোন তেল ব্যবহার করলে ভালো হয় আপু?',
        minutesAgo: 85,
        likes: 2,
      },
    ],
  },
  {
    id: 'post-relatable-4',
    authorName: 'তানজিলা হক',
    isVerifiedBuyer: true,
    topic: 'খাবার',
    content: 'আজকের বিকেলের পুষ্টিকর নাস্তায় ছিল মিষ্টি কুমড়া ও আপেল পিউরি, উপরে সামান্য এক চিমটি ওরেগানো। 🍎🎃 প্রাকৃতিক মিষ্টি ফ্লেভার থাকায় কোনো চিনি বা মিষ্টি ছাড়াই বাবু পুরো বাটি শেষ করেছে! ৬ মাসের পর থেকে ঘরের তৈরি এমন পুষ্টিকর খাবার দিলে শিশুদের হজমশক্তি ও রোগ প্রতিরোধ ক্ষমতা বাড়ে।',
    mediaUrl: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=700&auto=format&fit=crop&q=80',
    mediaType: 'image',
    minutesAgo: 240,
    likes: 37,
    reactionTypes: ['love', 'like'],
    comments: [
      {
        authorName: 'ফারজানা আক্তার',
        content: 'দেখেই খুব লোভনীয় লাগছে! ওরেগানোর ফ্লেভারটা বাবুর খুব ভালো লাগে।',
        minutesAgo: 210,
        likes: 3,
      },
    ],
  },
  {
    id: 'post-relatable-5',
    authorName: 'আয়েশা সিদ্দিকা',
    isVerifiedBuyer: true,
    topic: 'মায়ের গল্প',
    content: 'সবাই যখন শিশুর যত্ন নিয়ে ব্যস্ত থাকে, মায়েরা নিজেদের যত্নের কথা প্রায়ই ভুলে যাই। রাতের পর রাত নির্ঘুম থাকা, নিজের খাওয়া-দাওয়ায় অবহেলা... অথচ একজন সুস্থ ও হাসিখুশি মা-ই পারে সন্তানকে সুস্থ মনন দিয়ে গড়ে তুলতে।\n\nসব মমতাময়ী মায়েদের প্রতি শ্রদ্ধা ও ভালোবাসা। দিনের কিছুটা সময় নিজের বিশ্রামের জন্যও রাখুন। ❤️🌸',
    mediaUrl: 'https://images.unsplash.com/photo-1555252333-9f8e92e65df9?w=700&auto=format&fit=crop&q=80',
    mediaType: 'image',
    minutesAgo: 360,
    likes: 95,
    reactionTypes: ['love', 'care'],
    comments: [
      {
        authorName: 'সাবিহা সুলতানা',
        content: 'একদম মনের কথা আপু! এই কথাগুলো প্রতিটা মায়ের নিয়মিত শোনা দরকার।',
        minutesAgo: 340,
        likes: 9,
      },
      {
        authorName: 'নুসরাত জাহান',
        content: 'ভালোবাসা আপু! আপনার লেখাটা পড়ে মনটা ভরে গেল।',
        minutesAgo: 310,
        likes: 5,
      },
    ],
  },
  {
    id: 'post-relatable-6',
    authorName: 'নাজনীন আকতার',
    isVerifiedBuyer: false,
    topic: 'বিকাশ',
    content: 'দাঁত ওঠার সময় বাবুরা সব কিছু কামড়াতে চায় এবং খাবারে কিছুটা অনীহা দেখায়। আমার ৯ মাসের বাবুর মাড়িতে যখন অস্বস্তি হতো, তখন আমি পরিষ্কার কোল্ড সিলিকন টিথার দিয়েছি। এতে সে বেশ আরাম পেয়েছে। দাঁত ওঠার সময়ে আপনারা কী কী করতেন?',
    mediaUrl: null,
    mediaType: null,
    minutesAgo: 600,
    likes: 31,
    reactionTypes: ['like', 'care'],
    comments: [
      {
        authorName: 'তানজিলা হক',
        content: 'ফ্রোজেন কলার স্লাইসও অনেক আরাম দেয় আপু।',
        minutesAgo: 550,
        likes: 3,
      },
    ],
  },
];

async function seedRelatableFeed(members, reviewUser) {
  // Remove older test posts if they are generic test posts
  await Post.deleteMany({
    $or: [
      { content: /test post/i },
      { content: /mone kisu nei/i },
      { _id: /^post-relatable-/ },
    ],
  });
  await Comment.deleteMany({ _id: /^comm-relatable-/ });

  const now = Date.now();

  for (let i = 0; i < POSTS_DATA.length; i++) {
    const p = POSTS_DATA[i];
    const authorUser = members.get(p.authorName) || reviewUser;
    const postCreatedAt = new Date(now - p.minutesAgo * 60 * 1000);

    const postDoc = await Post.create({
      _id: p.id,
      author: authorUser._id,
      authorName: p.authorName,
      authorAvatar: authorUser.avatar,
      isVerifiedBuyer: p.isVerifiedBuyer,
      topic: p.topic,
      content: p.content,
      mediaUrl: p.mediaUrl,
      mediaType: p.mediaType,
      status: 'approved',
      likes: p.likes,
      likedBy: [reviewUser._id],
      reactions: [
        { user: reviewUser._id, type: p.reactionTypes[0] || 'love' },
      ],
      reactionRewardedTo: [reviewUser._id],
      commentsCount: p.comments.length,
      createdAt: postCreatedAt,
      updatedAt: postCreatedAt,
    });

    for (let j = 0; j < p.comments.length; j++) {
      const c = p.comments[j];
      const commentAuthor = members.get(c.authorName) || reviewUser;
      const commentCreatedAt = new Date(now - c.minutesAgo * 60 * 1000);

      await Comment.create({
        _id: `comm-relatable-${i + 1}-${j + 1}`,
        post: postDoc._id,
        author: commentAuthor._id,
        authorName: c.authorName,
        authorAvatar: commentAuthor.avatar,
        content: c.content,
        likes: c.likes,
        createdAt: commentCreatedAt,
        updatedAt: commentCreatedAt,
      });
    }
  }

  console.log(`[seed] Successfully populated ${POSTS_DATA.length} relatable posts with comments.`);
}

async function main() {
  requireEnv('MONGODB_URI');
  await connectDB(env.mongodbUri);
  console.log('[seed] Connected to DB.');

  const members = await ensureMembers();
  const reviewUser = await ensureReviewUser(members);
  await seedRelatableFeed(members, reviewUser);

  console.log('[seed] Completed successfully!');
}

main()
  .catch((err) => {
    console.error('[seed] Error:', err);
    process.exitCode = 1;
  })
  .finally(disconnectDB);
