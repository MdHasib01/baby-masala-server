/**
 * Removes the demo data that `npm run seed:demo` puts in a database: the demo
 * admin (01712345678), the five sample mothers (*@community.babycare.demo) and
 * the sample feed posts/comments. Catalog data (products, recipes, gifts,
 * contests) is left alone.
 *
 *   npm run prune-demo             – dry run: only prints what would be deleted
 *   npm run prune-demo -- --apply  – deletes it
 */
import { connectDB, disconnectDB } from '../config/db.js';
import { env, requireEnv } from '../config/env.js';
import { Comment, Post, User } from '../models/index.js';
import { deleteAccount } from '../services/accountDeletion.js';
import { seedData } from './loadSeedData.js';

const apply = process.argv.includes('--apply');

async function main() {
  requireEnv('MONGODB_URI');
  await connectDB(env.mongodbUri);

  const users = await User.find({ $or: [{ contact: '01712345678' }, { contact: /@community\.babycare\.demo$/ }] });
  const postIds = seedData.posts.map((p) => p.id);
  const commentIds = seedData.comments.map((c) => c.id);
  const [posts, comments] = await Promise.all([
    Post.countDocuments({ _id: { $in: postIds } }),
    Comment.countDocuments({ $or: [{ _id: { $in: commentIds } }, { post: { $in: postIds } }] }),
  ]);

  console.log(`[prune] demo users: ${users.length}`);
  for (const u of users) console.log(`  - ${u.name} <${u.contact}> role=${u.role || 'user'}`);
  console.log(`[prune] sample posts: ${posts}, sample comments: ${comments}`);

  if (!apply) {
    console.log('[prune] dry run — nothing deleted. Re-run with "-- --apply" to delete.');
    return;
  }
  for (const u of users) await deleteAccount(u);
  await Comment.deleteMany({ $or: [{ _id: { $in: commentIds } }, { post: { $in: postIds } }] });
  await Post.deleteMany({ _id: { $in: postIds } });
  console.log('[prune] done');
}

main()
  .catch((err) => {
    console.error('[prune] failed:', err);
    process.exitCode = 1;
  })
  .finally(disconnectDB);
