import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

export const mailEnabled = () => Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);

let transport;
function getTransport() {
  transport ??= nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: { user: env.smtp.user, pass: env.smtp.pass },
  });
  return transport;
}

/** Emails a login/signup code. Throws a 502 HttpError when sending fails. */
export async function sendOtpEmail(to, code, minutes) {
  const subject = `Baby Care যাচাই কোড: ${code}`;
  const text =
    `আপনার Baby Care যাচাই কোড: ${code}\n` +
    `কোডটি ${minutes} মিনিট পর্যন্ত কার্যকর। কাউকে এই কোড জানাবেন না।\n\n` +
    `Your Baby Care verification code is ${code}. It expires in ${minutes} minutes. Do not share it with anyone.\n\n` +
    'আপনি এই কোড না চাইলে ইমেইলটি উপেক্ষা করুন। / If you did not request this, ignore this email.';
  const html = `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#FAF6F0;border-radius:16px;color:#2D2327">
  <h2 style="color:#56020A;margin:0 0 12px">Baby Care by Baby Masala</h2>
  <p style="margin:0 0 8px">আপনার যাচাই কোড / Your verification code:</p>
  <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#56020A;margin:8px 0 16px">${code}</p>
  <p style="margin:0 0 4px">কোডটি ${minutes} মিনিট পর্যন্ত কার্যকর। কাউকে এই কোড জানাবেন না।</p>
  <p style="margin:0 0 16px;color:#6b6b6b">It expires in ${minutes} minutes. Do not share it with anyone.</p>
  <p style="font-size:12px;color:#8a8a8a;margin:0">আপনি এই কোড না চাইলে ইমেইলটি উপেক্ষা করুন। If you did not request this code, you can ignore this email.</p>
</div>`;

  try {
    await getTransport().sendMail({ from: env.smtp.from, to, subject, text, html });
  } catch (err) {
    console.error('[mail] send failed', err?.message);
    throw new HttpError(502, 'কোড পাঠানো যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।', 'OTP_SEND_FAILED');
  }
}
