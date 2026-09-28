# Wiring the frontend to this backend

`api.js` in this folder is a plain-JS client with no dependencies — copy it
next to `index.html` and add one script tag before your closing `</body>`:

```html
<script src="api.js"></script>
<script>
  // Point at your deployed backend once it's live (Render/Railway/Fly, etc.)
  window.CAMPUS_COIN_API_URL = "https://your-backend.onrender.com/api";
</script>
```

Everything is namespaced under `window.CampusCoinAPI`. It stores the JWT in
`sessionStorage` itself — you don't need to touch tokens directly.

## Swap points in `campus-coin-app.html`

| Screen | Mock code to replace | Call |
|---|---|---|
| Sign up | `onclick="openApp()"` on the register button | `await CampusCoinAPI.auth.register({name, email, password})` then `openApp()` |
| Log in | `onclick="openApp()"` on the login button | `await CampusCoinAPI.auth.login(email, password)` then `openApp()` |
| Dashboard | the hardcoded stat cards in `#sub-dashboard` | `const d = await CampusCoinAPI.dashboard.get()` — has `totals`, `health.score`, `health.safeToSpendToday`, `budgets`, `tips`, `recent` |
| Transactions table | the hardcoded `<tr>` rows | `await CampusCoinAPI.transactions.list({page:1, pageSize:10})` |
| Add transaction | the Save button | `await CampusCoinAPI.transactions.create({categoryId, amount, type, description, date})` |
| AI suggest chip | `suggestCategory()` (regex demo) | `await CampusCoinAPI.ai.categorize(description, type)` — same response shape |
| Budgets | hardcoded bars | `await CampusCoinAPI.budgets.list()` — each item has `percentUsed`, `alert` |
| Savings jars | hardcoded cards | `await CampusCoinAPI.goals.list()` |
| Split expenses | hardcoded rows | `await CampusCoinAPI.splits.list()` |
| Categories | hardcoded chips | `await CampusCoinAPI.categories.list()` — returns `{income:[], expense:[]}` |
| Reports table | hardcoded rows | `await CampusCoinAPI.reports.categoryBreakdown()` |
| Reports chart | hardcoded bar heights | `await CampusCoinAPI.reports.incomeVsExpense(6)` |
| Export as PDF | (nothing yet) | `const blob = await CampusCoinAPI.reports.exportPdfBlob(); ` then create an `<a>` with `URL.createObjectURL(blob)` |
| AI Assistant chat | hardcoded messages | `await CampusCoinAPI.ai.ask(question)` — returns `{answer}` |
| Insight history | hardcoded cards | `await CampusCoinAPI.ai.insights.list()` |
| Admin sign-in | the client-side `ADMIN_EMAIL`/`ADMIN_PASS` check in the page's own script | `await CampusCoinAPI.auth.adminLogin(email, password)` — **delete the hardcoded credentials from the HTML once this is wired**, since they're currently visible to anyone who views source |
| Admin overview | hardcoded numbers | `await CampusCoinAPI.admin.stats()` |
| Admin users table | hardcoded rows | `await CampusCoinAPI.admin.users.list()`, `.setDisabled()`, `.resetPassword()` |
| Admin default categories | hardcoded chips | `await CampusCoinAPI.admin.defaultCategories.list/create/remove()` |
| Admin announcements | hardcoded list | `await CampusCoinAPI.admin.announcements.list/create/remove()` |
| Admin activity log | hardcoded rows | `await CampusCoinAPI.admin.activityLog()` |

## Errors

Every call throws on failure with `err.message` set to the backend's error
text (e.g. "Invalid email or password") — safe to show directly to the user
in most cases.

```js
try {
  await CampusCoinAPI.auth.login(email, password);
  openApp();
} catch (err) {
  document.getElementById('loginError').textContent = err.message;
}
```

## CORS

The backend only allows the origins listed in its `CLIENT_ORIGIN` env var.
Add your Vercel URL there (comma-separated if you need more than one) and
redeploy the backend.
