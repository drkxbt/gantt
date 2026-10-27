/* Calendar days as plain numbers: a day is the count of whole days since 1 January 1970, read as a calendar date with
   no time zone. Adding 1 is always the next day, with no daylight-saving hour to trip over. */

export const DAY_MS = 86_400_000;

export type DateInput = string | Date | number;

/** A day from an ISO date ("2026-11-03"), a Date (its local calendar date), or a day number. */
export function toDay(input: DateInput): number {
  if (typeof input === "number") return Math.floor(input);
  if (input instanceof Date) return Math.floor(Date.UTC(input.getFullYear(), input.getMonth(), input.getDate()) / DAY_MS);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  if (!match) throw new Error(`Not an ISO date: ${input}`);
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS);
}

/** The ISO date of a day: "2026-11-03". */
export const toISO = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Today on the calendar of the machine it runs on. */
export const today = () => toDay(new Date());

/** Day of the week, Monday 0 to Sunday 6. Day 0, 1 January 1970, was a Thursday. */
export const weekday = (day: number) => (((day + 3) % 7) + 7) % 7;

export const isWeekend = (day: number) => weekday(day) >= 5;

export const startOfWeek = (day: number) => day - weekday(day);

export function startOfMonth(day: number): number {
  const date = new Date(day * DAY_MS);
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / DAY_MS);
}

export function addMonths(day: number, months: number): number {
  const date = new Date(day * DAY_MS);
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1) / DAY_MS);
}

export function startOfYear(day: number): number {
  return Math.floor(Date.UTC(new Date(day * DAY_MS).getUTCFullYear(), 0, 1) / DAY_MS);
}

/** The ISO week number: weeks start on Monday, and week 1 holds the year's first Thursday. */
export function isoWeek(day: number): number {
  const thursday = day - weekday(day) + 3;
  const yearStart = startOfYear(thursday);
  return Math.floor((thursday - yearStart) / 7) + 1;
}

/** A function that writes days out for people, in `locale`, read as calendar dates. Make one and reuse it: building
 *  the formatter is the slow part. */
export function dayFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions): (day: number) => string {
  const format = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
  return (day) => format.format(new Date(day * DAY_MS));
}
