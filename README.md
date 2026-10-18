# Baby Care API (Express + Mongoose)

The backend for **Baby Care by Baby Masala**. It stores everything in MongoDB through Mongoose and enforces the business rules from [`frontend/FRONTEND_HANDOFF.md`](../frontend/FRONTEND_HANDOFF.md) on the server: email OTP login, point awards, stock, redemptions and contest eligibility.

## Quick start

```bash
cd backend
npm install
cp .env.example .env        # then set MONGODB_URI and JWT_SECRET
npm run seed:demo           # local only: catalog + demo account, demo mothers and sample feed
npm run dev                 # http://localhost:5000  (auto-restarts on change)
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev                 # Vite proxies /api to http://localhost:5000
```

Locally, set `DEMO_MODE=true` to log in with the demo account `01712345678` and code `123456` (codes are only logged when SMTP is not configured). **Production runs with `DEMO_MODE=false`**: codes are emailed over SMTP and only email sign-up is accepted.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MONGODB_URI` | yes | – | Mongo connection string, local (`mongodb://127.0.0.1:27017/baby-care`) or Atlas (`mongodb+srv://…`) |
| `JWT_SECRET` | yes | – | Signs login tokens. Use a long random string. |
| `PORT` | no | `5000` | API port |
| `JWT_EXPIRES_IN` | no | `30d` | Token lifetime |
| `CLIENT_ORIGIN` | no | `http://localhost:5173,http://localhost:3000` | CORS allow-list, comma separated |
| `DEMO_MODE` | no | `false` | Local development only: `DEMO_OTP` verifies for every account. **Never enable in production.** |
| `DEMO_OTP` | no | `123456` | Demo verification code (only with `DEMO_MODE=true`) |
| `ADMIN_CONTACTS` | no | – | Emails that get the admin role on login |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | yes (prod) | port `465` | SMTP account that emails login codes (Gmail: `smtp.gmail.com`, 465, an App Password) |
| `EMAIL_FROM` | no | `SMTP_USER` | From header, e.g. `"Babymasala <support@babymasalabd.com>"` (with Gmail it must be a verified "Send mail as" alias) |
| `SMS_ENABLED` | no | `false` | Keep `false` until an SMS/WhatsApp provider is wired into `deliverOtp()`; phone sign-up is refused meanwhile |
| `REVIEW_CONTACT` / `REVIEW_OTP` | no | – | Google Play reviewer login: this one email accepts the fixed code and is sent no email. Never an admin. |
| `CLOUDINARY_*` | yes (prod) | – | Image storage (see `.env.example`) |

The frontend reads `VITE_API_URL` when the API runs on another host (for example `https://api.example.com/api`). In development the Vite proxy is used, and `API_PROXY_TARGET` changes its target.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with `node --watch` |
| `npm start` | Start for production |
| `npm run seed` | Insert the catalog (products, recipes, gifts, contests, doctors) if missing. Never overwrites existing records. |
| `npm run seed:demo` | Also create the demo admin, demo mothers and sample feed. **Local only.** |
| `npm run seed:reset` | **Drop the database**, then seed the catalog from scratch |
| `npm run prune-demo` | Dry run: list the demo users and sample feed in the database. `npm run prune-demo -- --apply` deletes them. |

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
| POST | `/api/auth/activate-membership` | | Kept for old clients; the app is free and every user is a member |

`/api/auth/*` POSTs are rate-limited to 30 per 15 minutes per IP.

**App data**

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/bootstrap` | Everything the app needs on first load, in one request |
| PATCH | `/api/me` | name, avatar, bio, coverPhoto, addresses, notificationPrefs, privacySettings |
| DELETE | `/api/me` | Permanently deletes the account and its data (Play Store requirement). Orders are kept but anonymised. Uploaded images are removed from Cloudinary. |
| POST / DELETE | `/api/users/:id/block` | Block / unblock a user: their posts and comments are hidden from me |
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

- **Phone OTP.** Only email codes are sent. Plug an SMS/WhatsApp provider into `deliverOtp()` in `src/routes/auth.js`, then set `SMS_ENABLED=true` and the apps' phone-login flags.
- **Friends, messenger and Ask Doctor** are per-user copies of demo data with no real counterpart, so the apps hide them. They need a shared social graph and a doctor-answer flow before coming back.
- **Online payment.** Orders are cash on delivery only (`paymentMethod` other than `cod` is rejected).
