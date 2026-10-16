import { Router } from 'express';
import { Doctor, OWNED } from '../models/index.js';
import { plain, serializeOwned } from '../services/serializers.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { pick } from '../utils/validate.js';

const router = Router();
const MAX_ITEMS = 1000;

function collectionFor(name) {
  const entry = Object.hasOwn(OWNED, name) ? OWNED[name] : null;
  if (!entry) throw notFound(`Unknown collection "${name}". Use one of: ${Object.keys(OWNED).join(', ')}.`);
  return entry;
}

// GET /api/sync/:collection — children | friends | conversations | messages | doctorQuestions
router.get('/sync/:collection', async (req, res) => {
  const { model, fields } = collectionFor(req.params.collection);
  const docs = await model.find({ owner: req.user._id }).sort({ position: 1, createdAt: 1 }).lean();
  res.json({ items: docs.map((d) => serializeOwned(d, fields)) });
});

/**
 * PUT /api/sync/:collection  { items: [...] }
 * Replaces the user's whole list: items are upserted by their `id` (order is
 * kept) and anything not in the list is deleted.
 */
router.put('/sync/:collection', async (req, res) => {
  const { model, fields } = collectionFor(req.params.collection);
  const owner = req.user._id;
  const items = req.body?.items;
  if (!Array.isArray(items)) throw badRequest('items must be an array.');
  if (items.length > MAX_ITEMS) throw badRequest(`Too many items (max ${MAX_ITEMS}).`);

  const seen = new Set();
  const docs = items.map((item, position) => {
    const clientId = item?.id;
    if (typeof clientId !== 'string' || !clientId || clientId.length > 100) {
      throw badRequest(`items[${position}].id must be a non-empty string.`);
    }
    if (seen.has(clientId)) throw badRequest(`Duplicate id "${clientId}".`);
    seen.add(clientId);
    return { owner, clientId, position, ...pick(item, fields) };
  });

  // Validate everything before writing anything.
  await Promise.all(docs.map((d) => model.validate(d)));

  if (docs.length) {
    await model.bulkWrite(
      docs.map((doc) => ({
        replaceOne: { filter: { owner, clientId: doc.clientId }, replacement: doc, upsert: true },
      })),
      { ordered: false }
    );
  }
  await model.deleteMany({ owner, clientId: { $nin: [...seen] } });

  res.json({ ok: true, count: docs.length });
});

router.get('/doctors', async (_req, res) => {
  const doctors = await Doctor.find().sort({ createdAt: 1 }).lean();
  res.json({ doctors: doctors.map(plain) });
});

export default router;
