// All month math is done in UTC so results don't depend on server timezone.

export function monthStart(input) {
  if (!input) {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
  }
  if (typeof input === "string" && /^\d{4}-\d{2}$/.test(input)) {
    const [y, m] = input.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1));
  }
  const d = new Date(input);
  if (isNaN(d.getTime())) return monthStart();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function addMonths(d, n) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

export function monthKey(d) {
  return d.toISOString().slice(0, 7);
}

export function monthLabel(d) {
  return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function daysInMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Same day next month, clamped (Jan 31 -> Feb 28/29).
export function addMonthsKeepDay(d, n = 1) {
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const day = Math.min(d.getUTCDate(), daysInMonth(first));
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day));
}

export function startOfTodayUTC() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}
