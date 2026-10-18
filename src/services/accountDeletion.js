import {
  Comment,
  Complaint,
  ContestSubmission,
  GiftRedemption,
  Notification,
  Order,
  Otp,
  OWNED,
  Post,
  Recipe,
  RewardTransaction,
  User,
} from '../models/index.js';
import { destroyByUrls } from './cloudinary.js';

/**
 * Permanently deletes a user and everything they created. Orders are kept for
 * accounting but stripped of anything that identifies the person.
 */
export async function deleteAccount(user) {
  const uid = user._id;

  const [children, messages, questions, posts, submissions, complaints] = await Promise.all([
    OWNED.children.model.find({ owner: uid }, { photo: 1 }).lean(),
    OWNED.messages.model.find({ owner: uid }, { mediaUrl: 1 }).lean(),
    OWNED.doctorQuestions.model.find({ owner: uid }, { attachmentUrl: 1 }).lean(),
    Post.find({ author: uid }, { mediaUrl: 1 }).lean(),
    ContestSubmission.find({ user: uid }, { mediaUrl: 1 }).lean(),
    Complaint.find({ user: uid }, { attachmentUrl: 1 }).lean(),
  ]);
  const mediaUrls = [
    user.avatar,
    user.coverPhoto,
    ...children.map((d) => d.photo),
    ...messages.map((d) => d.mediaUrl),
    ...questions.map((d) => d.attachmentUrl),
    ...posts.map((d) => d.mediaUrl),
    ...submissions.map((d) => d.mediaUrl),
    ...complaints.map((d) => d.attachmentUrl),
  ];

  // Comments on other people's posts change those posts' comment counts.
  const ownPostIds = posts.map((p) => p._id);
  const ownComments = await Comment.find({ author: uid }, { post: 1 }).lean();
  const touchedPosts = [...new Set(ownComments.map((c) => c.post))].filter((id) => !ownPostIds.includes(id));
  const ownCommentIds = ownComments.map((c) => c._id);

  await Promise.all([
    ...Object.values(OWNED).map(({ model }) => model.deleteMany({ owner: uid })),
    Notification.deleteMany({ owner: uid }),
    Otp.deleteMany({ contact: user.contact }),
    Comment.deleteMany({ $or: [{ author: uid }, { post: { $in: ownPostIds } }, { parent: { $in: ownCommentIds } }] }),
    Post.deleteMany({ author: uid }),
    Post.updateMany({ likedBy: uid }, { $pull: { likedBy: uid, reactions: { user: uid } }, $inc: { likes: -1 } }),
    Post.updateMany(
      { $or: [{ savedBy: uid }, { hiddenBy: uid }, { reactionRewardedTo: uid }, { 'reports.user': uid }] },
      { $pull: { savedBy: uid, hiddenBy: uid, reactionRewardedTo: uid, reactions: { user: uid }, reports: { user: uid } } }
    ),
    Recipe.updateMany({ savedBy: uid }, { $pull: { savedBy: uid } }),
    User.updateMany({ blockedUsers: uid }, { $pull: { blockedUsers: uid } }),
    ContestSubmission.deleteMany({ user: uid }),
    GiftRedemption.deleteMany({ user: uid }),
    RewardTransaction.deleteMany({ user: uid }),
    Complaint.deleteMany({ user: uid }),
    Order.updateMany({ user: uid }, { $set: { user: 'deleted-user', shippingAddress: '[deleted]', notes: '', pointsReversed: true } }),
  ]);

  await Promise.all(
    touchedPosts.map(async (postId) =>
      Post.updateOne({ _id: postId }, { commentsCount: await Comment.countDocuments({ post: postId }) })
    )
  );

  await user.deleteOne();
  // Files last: a failure here must not leave the account half-deleted.
  await destroyByUrls(mediaUrls).catch((err) => console.error('[delete-account] media cleanup failed', err?.message));
}
