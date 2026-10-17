import { Router } from 'express';
import { COMPLAINT_CATEGORIES, Complaint } from '../models/index.js';
import { serializeComplaint } from '../services/serializers.js';
import { badRequest, tooMany } from '../utils/httpError.js';
import { optionalString, requireString } from '../utils/validate.js';

const router = Router();

const MAX_OPEN = 5;

// GET /api/complaints — the caller's own complaints, newest first.
router.get('/', async (req, res) => {
  const items = await Complaint.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ complaints: items.map(serializeComplaint) });
});

// POST /api/complaints  { category, details, attachmentUrl? }
router.post('/', async (req, res) => {
  const { category } = req.body || {};
  if (!COMPLAINT_CATEGORIES.includes(category)) throw badRequest('অভিযোগের ধরন নির্বাচন করুন।');
  const details = requireString(req.body?.details, 'অভিযোগের বিবরণ', { max: 2000 });
  const attachmentUrl = optionalString(req.body?.attachmentUrl, 'ছবি', { max: 2_000_000 });

  const open = await Complaint.countDocuments({ user: req.user._id, status: { $ne: 'resolved' } });
  if (open >= MAX_OPEN) throw tooMany('আপনার আগের অভিযোগগুলোর সমাধান হওয়া পর্যন্ত অপেক্ষা করুন।');

  const complaint = await Complaint.create({
    user: req.user._id,
    userName: req.user.name,
    userContact: req.user.contact,
    category,
    details,
    attachmentUrl,
  });
  res.status(201).json({ complaint: serializeComplaint(complaint.toObject()) });
});

export default router;
