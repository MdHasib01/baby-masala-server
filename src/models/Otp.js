import mongoose from 'mongoose';

const { Schema } = mongoose;

const otpSchema = new Schema(
  {
    contact: { type: String, required: true, index: true },
    contactMethod: { type: String, enum: ['email', 'whatsapp'], required: true },
    purpose: { type: String, enum: ['signup', 'login'], required: true },
    codeHash: { type: String, required: true },
    pendingName: String,
    attempts: { type: Number, default: 0 },
    // MongoDB's TTL monitor removes the document once this time has passed.
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

export const Otp = mongoose.model('Otp', otpSchema);
