# Campus Coin — backend

Node.js + Express + PostgreSQL (Prisma). Covers every functional requirement
in the SRS plus what the current frontend mock (`campus-coin-app.html`)
shows: dashboard with a financial health score and safe-to-spend, savings
jars, split expenses, AI categorization + chat assistant, monthly insights,
saving tips, budgets with alerts, CSV import, recurring transactions, PDF
export/email, and a full admin console.

## 1. Local setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:
- `DATABASE_URL` — a Postgres connection string. A free instance on
  [Neon](https://neon.tech), [Supabase](https://supabase.com), or
  [Railway](https://railway.app) works fine and takes about a minute to spin up.
- `JWT_SECRET` — any long random string (`openssl rand -hex 32` if you have it).
- Leave `SMTP_HOST` blank for now — without it, "emails" (password resets,
  shared reports) print to the server console instead of failing, so you can
  test the full flow before wiring a real email provider.

```bash
npm run db:push      # creates all tables from prisma/schema.prisma
npm run seed:demo    # admin account + a demo student with real sample data
npm run dev
```

The API is now at `http://localhost:4000/api`. `npm run seed:demo` prints
the admin and demo-student credentials to the console — use those to log in.

## 2. Deploying

This is a plain Express app, so **Vercel** works via the included
`api/index.js` + `vercel.json` (serverless), and it also runs unmodified
on **Render** or **Railway** (`npm start`) if you'd rather have a
persistent server for the hourly recurring-transactions job — see the note
in `src/index.js`. On serverless, run `processRecurring()` from `POST
/api/transactions` instead of a timer, or set up a cron trigger; the SRS
doesn't require real-time recurrence, so this is a "nice to have", not a
blocker for submission.

Set the same env vars on whichever host you pick, plus:
- `CLIENT_ORIGIN` — your deployed frontend URL (comma-separated for more than one)
- `APP_URL` — same, used to build links in reset-password emails

Then `npm run db:deploy` (or `db:push` again) against the production
database, and `npm run seed` to create the production admin account —
**use a real password this time**, not the one in `.env.example`.

## 3. Connecting the frontend

See `frontend-integration/WIRING_GUIDE.md` and `frontend-integration/api.js`.
The short version: copy `api.js` next to `index.html`, set
`window.CAMPUS_COIN_API_URL`, and replace the mock data in each screen with
the matching `CampusCoinAPI.*` call. The guide has a full table, screen by screen.

**Before you submit:** the admin sign-in on the current frontend checks a
hardcoded email/password inside the page's own `<script>` tag — visible to
anyone who views source. Once you wire `CampusCoinAPI.auth.adminLogin()` in
(step in the guide), delete those hardcoded credentials from the HTML.

## 4. API reference

All authenticated requests send `Authorization: Bearer <token>`. Students
and admins get separate tokens from separate login endpoints and can't use
each other's routes (`requireStudent` / `requireAdmin` middleware).

### Auth — `/api/auth`
| Method | Path | Notes |
|---|---|---|
| POST | `/register` | Creates a student, copies the admin-managed default categories |
| POST | `/login` | Student login |
| POST | `/admin/login` | Admin-only; rate-limited to 5 attempts / 30s, mirrors the frontend's lockout |
| POST | `/logout` | Records admin sign-outs in the activity log |
| GET | `/me` | Current user |
| PUT | `/profile` | Update name, academic year, allowance, savings goal |
| PUT | `/password` | Change password |
| POST | `/forgot-password` | Emails a reset link (or logs it, without SMTP set) |
| POST | `/reset-password` | Consumes the token |

### Dashboard — `/api`
| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard` | Everything the dashboard screen needs in one call: totals, health score, safe-to-spend, top budgets, tips, recent transactions |
| GET | `/notifications` | Live budget alerts + admin announcements |

### Categories, Transactions, Budgets, Goals, Splits
Standard REST under `/api/categories`, `/api/transactions`, `/api/budgets`,
`/api/goals`, `/api/splits`. Transactions support CSV import
(`POST /transactions/import`, multipart field `file`), soft delete + restore
+ full history, and recurring transactions (`isRecurring`, materialized
hourly or on-demand via `processRecurring()`).

### Reports — `/api/reports`
Category breakdown (with date-range/category/type filters), income-vs-expense
trend, daily/weekly period summary, a simple next-month forecast, PDF export,
and emailing the report (e.g. to a parent).

### AI — `/api/ai`
Keyword-based categorization that **learns from corrections** (no black-box
model — explainable, and matches the SRS's own rule against submitting
AI-generated work you can't explain), a batch endpoint for CSV import, a
natural-language `POST /ask` endpoint for the chat assistant, monthly
insight generation with pin/note, and the ranked saving-tips engine with
pin/dismiss/note.

### Admin — `/api/admin` (all routes require an admin token)
Stats overview, user search + disable/enable + password reset, the
default-category catalog every new student inherits, announcements/tip
templates, and the activity log — everything the SRS lists for the admin
panel, and everything the frontend's admin console screens expect.

## 5. What's deliberately simplified (and why that's fine for this brief)

- **AI is rule-based, not a hosted ML model.** The SRS explicitly wants
  something you can explain in a judging Q&A, not a black box — this is
  that, and it genuinely improves as students correct it.
- **Health score is a formula**, not a fitted model — no training data
  exists yet, so a documented deterministic formula is the honest choice.
- **Recurring transactions materialize on request or hourly**, not via a
  dedicated job scheduler — sufficient for a demo; swap in a real cron/queue
  post-hackathon if this becomes a real product.
- **Image export isn't a backend endpoint.** PDF export is real
  (`GET /reports/export.pdf`); a screenshot-style image export is better
  done client-side (e.g. `html2canvas` on the rendered report), which the
  original guidance already flagged.
