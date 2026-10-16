import { Notification, OWNED } from '../models/index.js';
import { seedData } from '../seed/loadSeedData.js';

/**
 * Gives a newly registered mother something to look at: the suggested-mothers
 * list and a welcome notification. Children, orders and points start empty,
 * matching the "new user" empty states in the UI.
 */
export async function provisionNewUser(user) {
  const friends = seedData.friends.map((f, position) => {
    const { id, ...rest } = f;
    return { ...rest, clientId: id, owner: user._id, position };
  });

  await Promise.all([
    OWNED.friends.model.insertMany(friends, { ordered: false }).catch(() => {}),
    Notification.create({
      owner: user._id,
      title: 'স্বাগতম বেবি কেয়ারে!',
      message: `${user.name}, বেবি কেয়ার পরিবারে আপনাকে স্বাগতম। কমিউনিটিতে প্রথম পোস্ট করে ৫ পয়েন্ট অর্জন করুন!`,
      type: 'community',
    }),
  ]);
}
