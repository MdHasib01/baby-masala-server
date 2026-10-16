// Converts lean Mongo documents into the exact shapes in frontend/src/types.ts.
import { dayLabelBn, relativeBn } from '../utils/bnTime.js';

/** Generic: `_id` -> `id`, drops Mongo bookkeeping fields. */
export function plain(doc) {
  if (!doc) return doc;
  const { _id, __v, createdAt, updatedAt, ...rest } = doc;
  return { id: _id, ...rest };
}

export function serializeUser(u) {
  return {
    id: u._id,
    name: u.name,
    contact: u.contact,
    contactMethod: u.contactMethod,
    role: u.role,
    isAdmin: u.role === 'admin',
    isVerified: u.isVerified,
    isMember: u.isMember,
    membershipExpiry: u.membershipExpiry,
    couponUsed: u.couponUsed,
    avatar: u.avatar,
    bio: u.bio,
    coverPhoto: u.coverPhoto,
    addresses: u.addresses || [],
    notificationPrefs: u.notificationPrefs,
    privacySettings: u.privacySettings,
    earnedPoints: u.earnedPoints,
    spentPoints: u.spentPoints,
  };
}

export function serializePost(p, viewerId) {
  return {
    id: p._id,
    authorId: p.author,
    authorName: p.authorName,
    authorAvatar: p.authorAvatar,
    isVerifiedBuyer: p.isVerifiedBuyer,
    topic: p.topic,
    content: p.content,
    mediaUrl: p.mediaUrl,
    mediaType: p.mediaType,
    createdAt: relativeBn(p.createdAt),
    likes: p.likes,
    likedByMe: (p.likedBy || []).includes(viewerId),
    savedByMe: (p.savedBy || []).includes(viewerId),
    commentsCount: p.commentsCount,
    status: p.status,
  };
}

export function serializeComment(c) {
  return {
    id: c._id,
    postId: c.post,
    authorId: c.author,
    authorName: c.authorName,
    authorAvatar: c.authorAvatar,
    content: c.content,
    createdAt: relativeBn(c.createdAt),
    likes: c.likes,
  };
}

export function serializeRecipe(r, viewerId) {
  const { savedBy, ...rest } = plain(r);
  return { ...rest, saved: (savedBy || []).includes(viewerId) };
}

export function serializeOrder(o) {
  return {
    id: o._id,
    items: o.items,
    subtotal: o.subtotal,
    deliveryCharge: o.deliveryCharge,
    totalAmount: o.totalAmount,
    status: o.status,
    shippingAddress: o.shippingAddress,
    notes: o.notes,
    paymentMethod: o.paymentMethod,
    createdAt: dayLabelBn(o.createdAt),
    pointsEarned: o.pointsEarned,
  };
}

export function serializeRewardTx(t) {
  return { id: t._id, date: dayLabelBn(t.createdAt), description: t.description, points: t.points, type: t.type };
}

export function serializeRedemption(r) {
  return {
    id: r._id,
    giftId: r.gift,
    giftName: r.giftName,
    pointsCost: r.pointsCost,
    status: r.status,
    createdAt: relativeBn(r.createdAt),
  };
}

export function serializeSubmission(s) {
  return {
    id: s._id,
    contestId: s.contest,
    userName: s.userName,
    mediaUrl: s.mediaUrl,
    description: s.description,
    status: s.status,
    createdAt: relativeBn(s.createdAt),
    orderId: s.order,
  };
}

export function serializeNotification(n) {
  return { id: String(n._id), title: n.title, message: n.message, time: relativeBn(n.createdAt), read: n.read, type: n.type };
}

/** Owned (client-synced) docs: the frontend id lives in `clientId`. */
export function serializeOwned(doc, fields) {
  const out = { id: doc.clientId };
  for (const f of fields) if (doc[f] !== undefined) out[f] = doc[f];
  return out;
}

/** Cart is stored as product ids; the UI wants full products. */
export function serializeCart(cart, productsById) {
  return (cart || [])
    .map((item) => {
      const product = productsById.get(item.product);
      return product ? { product: plain(product), quantity: item.quantity } : null;
    })
    .filter(Boolean);
}
