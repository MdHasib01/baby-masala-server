import { Router } from 'express';
import {
  COMPLAINT_STATUSES,
  Comment,
  Complaint,
  ContestSubmission,
  Notification,
  ORDER_STATUSES,
  Order,
  Post,
  Product,
} from '../models/index.js';
import { awardPoints } from '../services/points.js';
import {
  plain,
  serializeComplaint,
  serializeOrder,
  serializePost,
  serializeRewardTx,
  serializeSubmission,
} from '../services/serializers.js';
import { badRequest, notFound } from '../utils/httpError.js';

// Mounted behind requireAuth + requireAdmin.
const router = Router();

router.get('/overview', async (req, res) => {
  const [posts, orders, products, submissions, complaints] = await Promise.all([
    Post.find().sort({ createdAt: -1 }).limit(200).lean(),
    Order.find().sort({ createdAt: -1 }).limit(200).lean(),
    Product.find().sort({ createdAt: 1 }).lean(),
    ContestSubmission.find().sort({ createdAt: -1 }).limit(200).lean(),
    Complaint.find().sort({ createdAt: -1 }).limit(200).lean(),
  ]);
  res.json({
    posts: posts.map((p) => ({ ...serializePost(p, req.user._id), reportsCount: p.reports?.length || 0 })),
    orders: orders.map((o) => ({ ...serializeOrder(o), userId: o.user })),
    products: products.map(plain),
    submissions: submissions.map(serializeSubmission),
    complaints: complaints.map(serializeComplaint),
  });
});

// PATCH /api/admin/posts/:id  { status: 'approved' | 'pending' | 'rejected' }
router.patch('/posts/:id', async (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'pending', 'rejected'].includes(status)) throw badRequest('Invalid status.');
  const post = await Post.findByIdAndUpdate(req.params.id, { status }, { returnDocument: 'after' }).lean();
  if (!post) throw notFound('পোস্টটি খুঁজে পাওয়া যায়নি।');
  res.json({ post: serializePost(post, req.user._id) });
});

router.delete('/posts/:id', async (req, res) => {
  const post = await Post.findByIdAndDelete(req.params.id).lean();
  if (!post) throw notFound('পোস্টটি খুঁজে পাওয়া যায়নি।');
  await Comment.deleteMany({ post: post._id });
  res.json({ ok: true });
});

/**
 * PATCH /api/admin/orders/:id  { status }
 * Points were credited at checkout; cancelling reverses them once and restocks.
 */
router.patch('/orders/:id', async (req, res) => {
  const { status } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) throw badRequest(`status must be one of: ${ORDER_STATUSES.join(', ')}`);

  const order = await Order.findById(req.params.id);
  if (!order) throw notFound('অর্ডারটি খুঁজে পাওয়া যায়নি।');
  if (order.status === 'cancelled' && status !== 'cancelled') {
    throw badRequest('বাতিল হওয়া অর্ডার আর পরিবর্তন করা যাবে না।');
  }

  let tx = null;
  if (status === 'cancelled' && order.status !== 'cancelled') {
    await Promise.all(
      order.items.map((i) => Product.updateOne({ _id: i.product.id }, { $inc: { stock: i.quantity } }))
    );
    if (order.pointsEarned > 0 && !order.pointsReversed) {
      tx = await awardPoints(order.user, -order.pointsEarned, `অর্ডার #${order._id} বাতিল হওয়ায় পয়েন্ট রিভার্সাল`, {
        source: 'order_reversal',
        refId: order._id,
      });
      order.pointsReversed = true;
    }
  }
  order.status = status;
  await order.save();

  res.json({ order: serializeOrder(order.toObject()), rewardTx: tx ? serializeRewardTx(tx) : null });
});

// PATCH /api/admin/products/:id  { stock?, price?, pointsEarned? }
router.patch('/products/:id', async (req, res) => {
  const updates = {};
  for (const field of ['stock', 'price', 'pointsEarned']) {
    if (req.body?.[field] === undefined) continue;
    const n = Number(req.body[field]);
    if (!Number.isFinite(n) || n < 0) throw badRequest(`${field} must be a non-negative number.`);
    updates[field] = field === 'stock' ? Math.floor(n) : n;
  }
  const product = await Product.findByIdAndUpdate(req.params.id, updates, {
    returnDocument: 'after',
    runValidators: true,
  }).lean();
  if (!product) throw notFound('প্রোডাক্টটি খুঁজে পাওয়া যায়নি।');
  res.json({ product: plain(product) });
});

// PATCH /api/admin/submissions/:id  { status }
router.patch('/submissions/:id', async (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'approved', 'rejected'].includes(status)) throw badRequest('Invalid status.');
  const sub = await ContestSubmission.findByIdAndUpdate(req.params.id, { status }, { returnDocument: 'after' }).lean();
  if (!sub) throw notFound('সাবমিশনটি খুঁজে পাওয়া যায়নি।');
  res.json({ submission: serializeSubmission(sub) });
});

const COMPLAINT_STATUS_BN = { open: 'গ্রহণ করা হয়েছে', in_progress: 'প্রক্রিয়াধীন', resolved: 'সমাধান হয়েছে' };

// PATCH /api/admin/complaints/:id  { status?, adminReply? }  — the user gets a notification.
router.patch('/complaints/:id', async (req, res) => {
  const { status, adminReply } = req.body || {};
  if (status !== undefined && !COMPLAINT_STATUSES.includes(status)) throw badRequest('Invalid status.');
  if (adminReply !== undefined && (typeof adminReply !== 'string' || adminReply.length > 1000)) {
    throw badRequest('উত্তর সর্বোচ্চ ১০০০ অক্ষরের হতে পারে।');
  }
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw notFound('অভিযোগটি খুঁজে পাওয়া যায়নি।');

  const statusChanged = status !== undefined && status !== complaint.status;
  const replyChanged = adminReply !== undefined && adminReply.trim() !== complaint.adminReply;
  if (status !== undefined) complaint.status = status;
  if (adminReply !== undefined) complaint.adminReply = adminReply.trim();
  await complaint.save();

  if (statusChanged || replyChanged) {
    const reply = complaint.adminReply ? ` উত্তর: ${complaint.adminReply}` : '';
    await Notification.create({
      owner: complaint.user,
      title: 'অভিযোগের আপডেট',
      message: `আপনার অভিযোগ #${complaint._id} — ${COMPLAINT_STATUS_BN[complaint.status]}।${reply}`,
      type: 'complaint',
    });
  }
  res.json({ complaint: serializeComplaint(complaint.toObject()) });
});

export default router;
