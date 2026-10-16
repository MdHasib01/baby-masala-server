export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message, code) => new HttpError(400, message, code);
export const unauthorized = (message = 'লগইন প্রয়োজন।') => new HttpError(401, message, 'UNAUTHORIZED');
export const forbidden = (message = 'এই কাজের অনুমতি আপনার নেই।') => new HttpError(403, message, 'FORBIDDEN');
export const notFound = (message = 'খুঁজে পাওয়া যায়নি।') => new HttpError(404, message, 'NOT_FOUND');
export const conflict = (message, code) => new HttpError(409, message, code);
export const tooMany = (message) => new HttpError(429, message, 'RATE_LIMITED');
