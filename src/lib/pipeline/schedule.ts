const LONDON_TIME_ZONE = "Europe/London";

export function londonHour(date: Date): number | null {
  if (!Number.isFinite(date.getTime())) return null;
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).find((part) => part.type === "hour")?.value;
  const parsed = Number(hour);
  return Number.isInteger(parsed) ? parsed : null;
}

export function isSevenAmInLondon(date: Date): boolean {
  return londonHour(date) === 7;
}
