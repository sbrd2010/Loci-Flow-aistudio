export const AI_USAGE_LIMITS = Object.freeze({
  hourly: 40,
  daily: 120,
});

export const AI_DAILY_WARNING_THRESHOLDS = Object.freeze([
  { ratio: 0.5, label: "50%" },
  { ratio: 0.8, label: "80%" },
  { ratio: 0.95, label: "95%" },
  { ratio: 1, label: "100%" },
]);

function getDefaultStorage() {
  try {
    return typeof globalThis !== "undefined" ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

function storageUnavailableResult(limits) {
  return {
    allowed: true,
    storageAvailable: false,
    warning: null,
    hourly: { used: 0, limit: limits.hourly },
    daily: { used: 0, limit: limits.daily },
  };
}

function safeUserId(userId) {
  return String(userId || "signed-out")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

export function getAIUsageStorageKeys(userId, now = Date.now()) {
  const date = toDate(now);
  const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const hour = `${day}T${pad2(date.getHours())}`;
  const prefix = `loci_ai_usage_v1:${safeUserId(userId)}`;

  return {
    dayKey: `${prefix}:day:${day}`,
    hourKey: `${prefix}:hour:${hour}`,
  };
}

function readCount(storage, key) {
  const raw = storage.getItem(key);
  const parsed = Number.parseInt(raw || "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function writeCount(storage, key, count) {
  storage.setItem(key, String(count));
}

export function getDailyAIUsageWarning(previousUsed, nextUsed, dailyLimit = AI_USAGE_LIMITS.daily) {
  for (const threshold of AI_DAILY_WARNING_THRESHOLDS) {
    const target = Math.ceil(dailyLimit * threshold.ratio);
    if (previousUsed < target && nextUsed >= target) {
      return {
        threshold: threshold.label,
        used: nextUsed,
        limit: dailyLimit,
        remaining: Math.max(0, dailyLimit - nextUsed),
        isExhausted: nextUsed >= dailyLimit,
      };
    }
  }
  return null;
}

export function formatAIUsageWarning(warning) {
  if (!warning) return "";

  if (warning.isExhausted) {
    return `AI usage note: this reply used your ${warning.used}/${warning.limit} daily AI calls. AI will pause after this until tomorrow.`;
  }

  if (warning.threshold === "95%") {
    return `AI usage note: you have used ${warning.used}/${warning.limit} daily AI calls (${warning.threshold}). Only ${warning.remaining} left today.`;
  }

  if (warning.threshold === "80%") {
    return `AI usage note: you have used ${warning.used}/${warning.limit} daily AI calls (${warning.threshold}). Worth conserving a little now.`;
  }

  return `AI usage note: you have used ${warning.used}/${warning.limit} daily AI calls (${warning.threshold}). You still have ${warning.remaining} left today.`;
}

export function checkAndRecordAIUsage({
  userId,
  now = Date.now(),
  storage = getDefaultStorage(),
  limits = AI_USAGE_LIMITS,
} = {}) {
  if (!storage) {
    return storageUnavailableResult(limits);
  }

  let dayKey;
  let hourKey;
  let dayUsed;
  let hourUsed;

  try {
    ({ dayKey, hourKey } = getAIUsageStorageKeys(userId, now));
    dayUsed = readCount(storage, dayKey);
    hourUsed = readCount(storage, hourKey);
  } catch {
    return storageUnavailableResult(limits);
  }

  if (dayUsed >= limits.daily) {
    return {
      allowed: false,
      limitType: "daily",
      message: `AI daily limit reached: you have used ${dayUsed}/${limits.daily} AI calls today. Loci will reset your AI allowance tomorrow.`,
      hourly: { used: hourUsed, limit: limits.hourly },
      daily: { used: dayUsed, limit: limits.daily },
    };
  }

  if (hourUsed >= limits.hourly) {
    return {
      allowed: false,
      limitType: "hourly",
      message: `AI hourly limit reached: you have used ${hourUsed}/${limits.hourly} AI calls this hour. Try again after the hour resets.`,
      hourly: { used: hourUsed, limit: limits.hourly },
      daily: { used: dayUsed, limit: limits.daily },
    };
  }

  const nextDayUsed = dayUsed + 1;
  const nextHourUsed = hourUsed + 1;

  try {
    writeCount(storage, dayKey, nextDayUsed);
    writeCount(storage, hourKey, nextHourUsed);
  } catch {
    return storageUnavailableResult(limits);
  }

  return {
    allowed: true,
    storageAvailable: true,
    warning: getDailyAIUsageWarning(dayUsed, nextDayUsed, limits.daily),
    hourly: { used: nextHourUsed, limit: limits.hourly },
    daily: { used: nextDayUsed, limit: limits.daily },
  };
}

export function appendAIUsageWarning(reply, warning) {
  const note = formatAIUsageWarning(warning);
  if (!note) return reply;
  return `${String(reply || "").trim()}\n\n${note}`;
}
