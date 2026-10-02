const inrFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const countFormat = new Intl.NumberFormat("en-IN");
const timeFormat = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata",
});
const shortTimeFormat = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata",
});
const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

/** Rupees with Indian digit grouping: ₹12,00,000. */
export const inr = (n: number) => `₹${inrFormat.format(Math.round(n))}`;
export const count = (n: number) => countFormat.format(n);
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const clockTime = (ms: number) => timeFormat.format(ms);
export const shortTime = (ms: number) => shortTimeFormat.format(ms);
export const clockDate = (ms: number) => dateFormat.format(ms);
const shortDateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
export const shortDate = (ms: number) => shortDateFormat.format(ms);
/** "about 3 h 35 min", "about 40 min". */
export const duration = (minutes: number) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
