# Baby Care API (Express + Mongoose)

The backend for **Baby Care by Baby Masala**. It stores everything in MongoDB through Mongoose and enforces the business rules from [`frontend/FRONTEND_HANDOFF.md`](../frontend/FRONTEND_HANDOFF.md) on the server: OTP login, the membership coupon, point awards, stock, redemptions and contest eligibility.

## Quick start

```bash
cd backend
npm install
cp .env.example .env        # then set MONGODB_URI and JWT_SECRET
npm run seed                # load products, recipes, gifts, the demo account and the feed
npm run dev                 # http://localhost:5000  (auto-restarts on change)
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev                 # Vite proxies /api to http://localhost:5000
```

Log in with the demo account `01712345678` and code `123456`. The membership coupon is `BABYCARE`.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MONGODB_URI` | yes | – | Mongo connection string, local (`mongodb://127.0.0.1:27017/baby-care`) or Atlas (`mongodb+srv://…`) |
| `JWT_SECRET` | yes | – | Signs login tokens. Use a long random string. |
| `PORT` | no | `5000` | API port |
| `JWT_EXPIRES_IN` | no | `30d` | Token lifetime |
| `CLIENT_ORIGIN` | no | `http://localhost:5173,http://localhost:3000` | CORS allow-list, comma separated |
| `DEMO_MODE` | no | `true` | When on, `DEMO_OTP` always verifies and the fictional membership purchase works. **Set to `false` in production.** |
| `DEMO_OTP` | no | `123456` | Demo verification code |
| `MEMBERSHIP_COUPON` | no | `BABYCARE` | Coupon that activates membership |
| `ADMIN_CONTACTS` | no | – | Phones or emails that get the admin role on sign-up or login |

The frontend reads `VITE_API_URL` when the API runs on another host (for example `https://api.example.com/api`). In development the Vite proxy is used, and `API_PROXY_TARGET` changes its target.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with `node --watch` |
| `npm start` | Start for production |
| `npm run seed` | Insert seed data that is missing. Never overwrites existing records. |
| `npm run seed:reset` | **Drop the database**, then seed from scratch |

The seed data in `src/seed/seedData.json` is the frontend's original mock data (`frontend/src/data/*.ts`), exported to JSON.

## Project layout

```
src/
  server.js            connects to MongoDB, starts HTTP, graceful shutdown
  app.js               Express app, middleware and route mounting
  config/              env loading, mongoose connection
  models/              Mongoose schemas
    User, Otp
    Community.js       Post, Comment, Recipe, Doctor
    Commerce.js        Product, Order, Gift, GiftRedemption, RewardTransaction, Contest, ContestSubmission
    Owned.js           per-user synced lists (Child, Friend, Conversation, Message, DoctorQuestion) + Notification
  routes/              auth, me (bootstrap/profile/cart), posts, shop, rewards, sync, admin
  services/            point rules, leaderboard, response serializers, new-user starter data
  middleware/          JWT auth, admin guard, error handler
  utils/               ids, Bengali date labels, Bengali text normalisation, validation
  seed/                seed script and data
```

## API

Every route except `/api/health` and `/api/auth/request-otp|verify-otp` needs `Authorization: Bearer <token>`. Errors come back as `{ "message": "<Bengali, safe to show>", "code": "<MACHINE_CODE>" }`. Responses use the shapes in `frontend/src/types.ts`.

**Auth**

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/request-otp` | `{ contact, mode: 'signup'\|'login', name? }` | Sends a 6-digit code (5 min, one per 30 s) |
| POST | `/api/auth/verify-otp` | `{ contact, code }` | Returns `{ token, user, isNewUser }`. 5 attempts per code. |
| GET | `/api/auth/me` | | |
| POST | `/api/auth/activate-membership` | `{ couponCode }` | |
| POST | `/api/auth/demo-purchase` | | Demo mode only |

**App data**

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/bootstrap` | Everything the app needs on first load, in one request |
| PATCH | `/api/me` | name, avatar, bio, coverPhoto, addresses, notificationPrefs, privacySettings |
| PUT | `/api/me/cart` | `{ items: [{ productId, quantity }] }` |
| GET / POST | `/api/notifications`, `/api/notifications/read-all` | |
| GET / PUT | `/api/sync/:collection` | `children`, `friends`, `conversations`, `messages`, `doctorQuestions`. PUT replaces the whole list: `{ items: [...] }` |
| GET | `/api/doctors` | |

**Community**

| Method | Path | Points |
| --- | --- | --- |
| GET | `/api/posts?limit=&before=&topic=` | |
| POST | `/api/posts` `{ content, topic, mediaUrl? }` | +5 text/image, +10 video |
| PATCH / DELETE | `/api/posts/:id` | author only (admins may delete) |
| POST | `/api/posts/:id/react` | toggles like; +2 the first time per user per post, never again |
| POST | `/api/posts/:id/save` · `/hide` · `/report` | |
| GET / POST | `/api/posts/:id/comments` `{ content }` | +2 per comment |
| GET | `/api/recipes` · POST `/api/recipes/:id/save` | |

**Shop, rewards, contests**

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/products`, `/api/products/:id` | |
| GET / POST | `/api/orders` | POST `{ items, shippingAddress, notes?, paymentMethod }`. Prices come from the DB; stock is decremented atomically and rolled back on failure; free delivery over ৳1000, otherwise ৳60. Points are the product's `pointsEarned × qty`, or 1 per ৳10, credited at checkout. |
| GET | `/api/rewards/summary` | balance + transactions + redemptions |
| GET | `/api/rewards/leaderboard?limit=` | ranked by total earned points, so redemptions never lower a rank |
| GET | `/api/rewards/gifts` | |
| POST | `/api/rewards/redeem` `{ giftId, deliveryAddress? }` | Balance (`earned − spent`) and stock are both checked atomically |
| GET | `/api/contests`, `/api/contests/submissions` | |
| POST | `/api/contests/:id/submissions` `{ description, mediaUrl?, orderId? }` | One entry per contest. `delivered_order` contests need a delivered order. Awards `pointsReward` (default 50). |

**Admin** (role `admin`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/admin/overview` | all posts, orders, products and submissions |
| PATCH / DELETE | `/api/admin/posts/:id` | `{ status }` for moderation |
| PATCH | `/api/admin/orders/:id` `{ status }` | Cancelling restocks and reverses the order's points (once) |
| PATCH | `/api/admin/products/:id` `{ stock?, price?, pointsEarned? }` | |
| PATCH | `/api/admin/submissions/:id` `{ status }` | |

## Design notes

- **Points.** `User.earnedPoints` and `User.spentPoints` are running totals kept next to the `RewardTransaction` log, so balance checks are a single conditional update (`$expr: earned − spent ≥ cost`). Writes are sequential, not wrapped in transactions, so the API also runs on a standalone `mongod`. On a replica set (Atlas), wrapping order and redemption writes in `session.withTransaction` would make them fully atomic.
- **Synced lists.** Children, friends, messenger and doctor questions have no server-side rules, so the client sends the whole list (`PUT /api/sync/:collection`). Each row keeps the client's id in `clientId`, unique per user.
- **Bengali text.** `য়/ড়/ঢ়` can be stored as one code point or as letter + nukta. Request bodies are normalised to the single code point (`utils/bnText.js`) so enum values such as post topics always match.
- **Dates** are stored as real `Date`s and returned as the Bengali labels the UI shows ("এইমাত্র", "২ ঘণ্টা আগে", "আজ", "২০ ফেব্রুয়ারি ২০২৬").

## Not done yet

- **OTP delivery.** Codes are printed to the server log (`[otp] …`). Plug an SMS, WhatsApp or email provider into `deliverOtp()` in `src/routes/auth.js` before turning off `DEMO_MODE`.
- **Friends and messenger** are per-user copies of demo data, not a shared social graph between real accounts.
- **Media** is stored as URLs or data URLs inside documents (body limit 8 MB). Move uploads to object storage (S3, Cloudinary) for production.
- **No rate limiting** beyond the OTP throttle. Add `express-rate-limit` or a proxy-level limit before going public.
