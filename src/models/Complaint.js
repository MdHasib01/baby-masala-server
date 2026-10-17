import mongoose from 'mongoose';
import { idField } from '../utils/ids.js';

const { Schema } = mongoose;

export const COMPLAINT_CATEGORIES = ['order', 'product', 'payment', 'app', 'community', 'other'];
export const COMPLAINT_STATUSES = ['open', 'in_progress', 'resolved'];

// User → admin complaints. Users create and read their own; admins set status and reply.
const complaintSchema = new Schema(
  {
    _id: idField('cmp'),
    user: { type: String, ref: 'User', required: true, index: true },
    // Copied at creation so the admin list needs no join.
    userName: { type: String, required: true },
    userContact: { type: String, default: '' },
    category: { type: String, enum: COMPLAINT_CATEGORIES, required: true },
    details: { type: String, required: true, trim: true, maxlength: 2000 },
    attachmentUrl: { type: String, maxlength: 2_000_000 },
    status: { type: String, enum: COMPLAINT_STATUSES, default: 'open', index: true },
    adminReply: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { timestamps: true }
);

export const Complaint = mongoose.model('Complaint', complaintSchema);
