import { randomBytes } from 'node:crypto';

/**
 * Readable, roughly time-ordered string ids such as "post-m2k9x1a3f4c2".
 * The frontend already uses prefixed string ids, so documents keep that shape.
 */
export const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

/** Mongoose field definition for a prefixed string _id. */
export const idField = (prefix) => ({ type: String, default: () => newId(prefix) });
