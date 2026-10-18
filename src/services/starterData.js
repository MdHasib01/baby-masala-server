import { Notification } from '../models/index.js';

/**
 * Gives a newly registered mother a welcome notification. Children, orders and
 * points start empty, matching the "new user" empty states in the UI.
 */
export async function provisionNewUser(user) {
  await Notification.create({
    owner: user._id,
    title: 'স্বাগতম বেবি কেয়ারে!',
    message: `${user.name}, বেবি কেয়ার পরিবারে আপনাকে স্বাগতম। কমিউনিটিতে প্রথম পোস্ট করে ৫ পয়েন্ট অর্জন করুন!`,
    type: 'community',
  });
}
