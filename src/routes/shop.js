import { Router } from 'express';
import { Notification, Order, Product, Recipe } from '../models/index.js';
import { awardPoints, POINT_RULES } from '../services/points.js';
import { plain, serializeOrder, serializeRecipe, serializeRewardTx } from '../services/serializers.js';
import { toBnDigits } from '../utils/bnTime.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { optionalString, requirePositiveInt, requireString } from '../utils/validate.js';

const router = Router();

const FREE_DELIVERY_OVER = 1000;
const DELIVERY_CHARGE = 60;

const pointsFor = (product, quantity) =>
  product.pointsEarned != null
    ? product.pointsEarned * quantity
    : Math.floor((product.price * quantity) / POINT_RULES.orderTakaPerPoint);

// GET /api/products?category=&q=
router.get('/products', async (req, res) => {
  const filter = {};
  if (req.query.category) filter.category = String(req.query.category);
  if (req.query.q) {
    const q = String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: { $regex: q, $options: 'i' } }, { description: { $regex: q, $options: 'i' } }];
  }
  const products = await Product.find(filter).sort({ createdAt: 1 }).lean();
  res.json({ products: products.map(plain) });
});

router.get('/products/:id', async (req, res) => {
  const product = await Product.findById(req.params.id).lean();
  if (!product) throw notFound('প্রোডাক্টটি খুঁজে পাওয়া যায়নি।');
  res.json({ product: plain(product) });
});

router.get('/orders', async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
  res.json({ orders: orders.map(serializeOrder) });
});

/**
 * POST /api/orders
 * { items: [{ productId, quantity }], shippingAddress, notes?, paymentMethod?: 'cod' }
 *
 * Prices and points come from the database, never the client. Stock is
 * decremented with conditional updates and rolled back if any line fails.
 */
router.post('/orders', async (req, res) => {
  const me = req.user;
  const rawItems = req.body?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw badRequest('কার্ট খালি।');
  if (rawItems.length > 50) throw badRequest('একটি অর্ডারে সর্বোচ্চ ৫০টি আইটেম।');

  const shippingAddress = requireString(req.body?.shippingAddress, 'ডেলিভারি ঠিকানা', { max: 500 });
  const notes = optionalString(req.body?.notes, 'notes', { max: 1000 });
  // Cash on delivery only; there is no online payment gateway.
  if (req.body?.paymentMethod && req.body.paymentMethod !== 'cod') throw badRequest('এখন শুধু ক্যাশ অন ডেলিভারি পাওয়া যাচ্ছে।');
  const paymentMethod = 'cod';

  const quantities = new Map();
  for (const item of rawItems) {
    const productId = item?.productId ?? item?.product?.id;
    if (typeof productId !== 'string') throw badRequest('Each item needs a productId.');
    const quantity = requirePositiveInt(item?.quantity, 'পরিমাণ', { max: 99 });
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }

  const products = await Product.find({ _id: { $in: [...quantities.keys()] } }).lean();
  if (products.length !== quantities.size) throw badRequest('কার্টের একটি প্রোডাক্ট আর পাওয়া যাচ্ছে না।');

  const reserved = [];
  try {
    for (const product of products) {
      const quantity = quantities.get(product._id);
      const result = await Product.updateOne(
        { _id: product._id, stock: { $gte: quantity } },
        { $inc: { stock: -quantity } }
      );
      if (result.modifiedCount !== 1) {
        throw conflict(`"${product.name}" পর্যাপ্ত স্টকে নেই।`, 'OUT_OF_STOCK');
      }
      reserved.push([product._id, quantity]);
    }
  } catch (err) {
    await Promise.all(reserved.map(([id, qty]) => Product.updateOne({ _id: id }, { $inc: { stock: qty } })));
    throw err;
  }

  const items = products.map((p) => ({ product: plain(p), quantity: quantities.get(p._id) }));
  const subtotal = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
  const deliveryCharge = subtotal > FREE_DELIVERY_OVER ? 0 : DELIVERY_CHARGE;
  const pointsEarned = items.reduce((sum, i) => sum + pointsFor(i.product, i.quantity), 0);

  const order = await Order.create({
    user: me._id,
    items,
    subtotal,
    deliveryCharge,
    totalAmount: subtotal + deliveryCharge,
    status: 'confirmed',
    shippingAddress,
    notes,
    paymentMethod,
    pointsEarned,
  });

  const [tx] = await Promise.all([
    awardPoints(me._id, pointsEarned, `সফল অর্ডার #${order._id} থেকে পয়েন্ট`, { source: 'order', refId: order._id }),
    Notification.create({
      owner: me._id,
      title: 'অর্ডার সফল',
      message: `আপনার অর্ডার #${order._id} নিশ্চিত হয়েছে। আপনি ${toBnDigits(pointsEarned)} পয়েন্ট অর্জন করেছেন।`,
      type: 'order',
    }),
  ]);
  me.cart = [];
  await me.save();

  const updatedProducts = await Product.find({ _id: { $in: [...quantities.keys()] } }).lean();
  res.status(201).json({
    order: serializeOrder(order.toObject()),
    rewardTx: tx ? serializeRewardTx(tx) : null,
    products: updatedProducts.map(plain),
  });
});

router.get('/recipes', async (req, res) => {
  const filter = req.query.ageGroup ? { ageGroup: String(req.query.ageGroup) } : {};
  const recipes = await Recipe.find(filter).sort({ createdAt: 1 }).lean();
  res.json({ recipes: recipes.map((r) => serializeRecipe(r, req.user._id)) });
});

// POST /api/recipes/:id/save — toggles bookmark
router.post('/recipes/:id/save', async (req, res) => {
  const uid = req.user._id;
  const recipe = await Recipe.findById(req.params.id).select('savedBy').lean();
  if (!recipe) throw notFound('রেসিপিটি খুঁজে পাওয়া যায়নি।');
  const update = recipe.savedBy.includes(uid) ? { $pull: { savedBy: uid } } : { $addToSet: { savedBy: uid } };
  const updated = await Recipe.findByIdAndUpdate(recipe._id, update, { returnDocument: 'after' }).lean();
  res.json({ recipe: serializeRecipe(updated, uid) });
});

export default router;
