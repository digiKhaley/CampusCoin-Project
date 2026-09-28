// Campus Coin API client — drop this into the frontend and swap the mock
// data calls for these. Uses fetch, no dependencies.
//
// <script src="api.js"></script>  (exposes window.CampusCoinAPI)

(function () {
  const BASE_URL = window.CAMPUS_COIN_API_URL || "http://localhost:4000/api";
  const TOKEN_KEY = "cc-token";
  const ADMIN_TOKEN_KEY = "cc-admin-token";

  function getToken(admin) {
    try { return sessionStorage.getItem(admin ? ADMIN_TOKEN_KEY : TOKEN_KEY); } catch { return null; }
  }
  function setToken(token, admin) {
    try { sessionStorage.setItem(admin ? ADMIN_TOKEN_KEY : TOKEN_KEY, token); } catch {}
  }
  function clearToken(admin) {
    try { sessionStorage.removeItem(admin ? ADMIN_TOKEN_KEY : TOKEN_KEY); } catch {}
  }

  async function request(path, { method = "GET", body, admin = false, formData } = {}) {
    const headers = {};
    const token = getToken(admin);
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body && !formData) headers["Content-Type"] = "application/json";

    const res = await fetch(BASE_URL + path, {
      method,
      headers,
      body: formData ? body : body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return null;

    const isPdf = res.headers.get("content-type")?.includes("application/pdf");
    if (isPdf) return res.blob();

    let data;
    try { data = await res.json(); } catch { data = null; }

    if (!res.ok) {
      const err = new Error(data?.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const api = {
    setApiUrl(url) { window.CAMPUS_COIN_API_URL = url; },
    isLoggedIn: () => !!getToken(false),
    isAdminLoggedIn: () => !!getToken(true),
    logoutStudent: () => clearToken(false),
    logoutAdmin: () => clearToken(true),

    auth: {
      async register(payload) {
        const d = await request("/auth/register", { method: "POST", body: payload });
        setToken(d.token, false); return d.user;
      },
      async login(email, password) {
        const d = await request("/auth/login", { method: "POST", body: { email, password } });
        setToken(d.token, false); return d.user;
      },
      async adminLogin(email, password) {
        const d = await request("/auth/admin/login", { method: "POST", body: { email, password } });
        setToken(d.token, true); return d.user;
      },
      me: () => request("/auth/me").then((d) => d.user),
      updateProfile: (payload) => request("/auth/profile", { method: "PUT", body: payload }).then((d) => d.user),
      changePassword: (currentPassword, newPassword) => request("/auth/password", { method: "PUT", body: { currentPassword, newPassword } }),
      forgotPassword: (email) => request("/auth/forgot-password", { method: "POST", body: { email } }),
      resetPassword: (email, token, newPassword) => request("/auth/reset-password", { method: "POST", body: { email, token, newPassword } }),
    },

    dashboard: {
      get: (month) => request(`/dashboard${month ? `?month=${month}` : ""}`),
      notifications: () => request("/notifications"),
    },

    categories: {
      list: (type) => request(`/categories${type ? `?type=${type}` : ""}`),
      create: (name, type) => request("/categories", { method: "POST", body: { name, type } }).then((d) => d.category),
      update: (id, name) => request(`/categories/${id}`, { method: "PUT", body: { name } }).then((d) => d.category),
      remove: (id) => request(`/categories/${id}`, { method: "DELETE" }),
    },

    transactions: {
      list: (params = {}) => request(`/transactions?${new URLSearchParams(params)}`),
      summary: (month) => request(`/transactions/summary${month ? `?month=${month}` : ""}`),
      recurring: () => request("/transactions/recurring"),
      create: (payload) => request("/transactions", { method: "POST", body: payload }),
      update: (id, payload) => request(`/transactions/${id}`, { method: "PUT", body: payload }).then((d) => d.transaction),
      remove: (id) => request(`/transactions/${id}`, { method: "DELETE" }),
      restore: (id) => request(`/transactions/${id}/restore`, { method: "POST" }).then((d) => d.transaction),
      history: (id) => request(`/transactions/${id}/history`).then((d) => d.history),
      importCsv: (file) => {
        const fd = new FormData(); fd.append("file", file);
        return request("/transactions/import", { method: "POST", body: fd, formData: true });
      },
    },

    budgets: {
      list: (month) => request(`/budgets${month ? `?month=${month}` : ""}`),
      upsert: (categoryId, limitAmount, month) => request("/budgets", { method: "POST", body: { categoryId, limitAmount, month } }).then((d) => d.budget),
      copyPrevious: (month) => request("/budgets/copy-previous", { method: "POST", body: { month } }),
      remove: (id) => request(`/budgets/${id}`, { method: "DELETE" }),
    },

    goals: {
      list: () => request("/goals").then((d) => d.goals),
      create: (name, targetAmount) => request("/goals", { method: "POST", body: { name, targetAmount } }).then((d) => d.goal),
      contribute: (id, amount) => request(`/goals/${id}/contribute`, { method: "POST", body: { amount } }).then((d) => d.goal),
      remove: (id) => request(`/goals/${id}`, { method: "DELETE" }),
    },

    splits: {
      list: () => request("/splits"),
      create: (payload) => request("/splits", { method: "POST", body: payload }).then((d) => d.split),
      settle: (id, settled) => request(`/splits/${id}/settle`, { method: "PATCH", body: { settled } }).then((d) => d.split),
      remove: (id) => request(`/splits/${id}`, { method: "DELETE" }),
    },

    reports: {
      categoryBreakdown: (params = {}) => request(`/reports/category-breakdown?${new URLSearchParams(params)}`),
      incomeVsExpense: (months = 6) => request(`/reports/income-vs-expense?months=${months}`),
      periodSummary: (params = {}) => request(`/reports/period-summary?${new URLSearchParams(params)}`),
      forecast: () => request("/reports/forecast"),
      exportPdfBlob: (month) => request(`/reports/export.pdf${month ? `?month=${month}` : ""}`),
      shareByEmail: (email, month) => request("/reports/share-email", { method: "POST", body: { email, month } }),
    },

    ai: {
      categorize: (description, type) => request("/ai/categorize", { method: "POST", body: { description, type } }),
      categorizeBatch: (items) => request("/ai/categorize/batch", { method: "POST", body: { items } }).then((d) => d.suggestions),
      correct: (description, categoryId) => request("/ai/categorize/correct", { method: "POST", body: { description, categoryId } }),
      ask: (question) => request("/ai/ask", { method: "POST", body: { question } }),
      insights: {
        list: () => request("/ai/insights").then((d) => d.insights),
        generate: (month) => request("/ai/insights/generate", { method: "POST", body: { month } }).then((d) => d.insight),
        pin: (id, pinned) => request(`/ai/insights/${id}`, { method: "PATCH", body: { pinned } }).then((d) => d.insight),
      },
      tips: {
        list: (month) => request(`/ai/tips${month ? `?month=${month}` : ""}`).then((d) => d.tips),
        pin: (categoryId, pinned) => request(`/ai/tips/${categoryId}`, { method: "PATCH", body: { pinned } }).then((d) => d.state),
        dismiss: (categoryId) => request(`/ai/tips/${categoryId}`, { method: "PATCH", body: { dismissed: true } }).then((d) => d.state),
      },
    },

    admin: {
      stats: () => request("/admin/stats", { admin: true }),
      users: {
        list: (q) => request(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`, { admin: true }),
        setDisabled: (id, isDisabled) => request(`/admin/users/${id}`, { method: "PATCH", body: { isDisabled }, admin: true }).then((d) => d.user),
        resetPassword: (id) => request(`/admin/users/${id}/reset-password`, { method: "POST", admin: true }),
      },
      defaultCategories: {
        list: () => request("/admin/default-categories", { admin: true }),
        create: (name, type) => request("/admin/default-categories", { method: "POST", body: { name, type }, admin: true }).then((d) => d.category),
        remove: (id) => request(`/admin/default-categories/${id}`, { method: "DELETE", admin: true }),
      },
      announcements: {
        list: () => request("/admin/announcements", { admin: true }).then((d) => d.announcements),
        create: (type, title, body) => request("/admin/announcements", { method: "POST", body: { type, title, body }, admin: true }).then((d) => d.announcement),
        remove: (id) => request(`/admin/announcements/${id}`, { method: "DELETE", admin: true }),
      },
      activityLog: () => request("/admin/activity-log", { admin: true }).then((d) => d.log),
    },
  };

  window.CampusCoinAPI = api;
})();
