import { normalizePayload } from "./normalizePayload";

// Preferred CSV column order. Any extra fields found on actual task objects are
// appended after these so no field is ever silently dropped.
const CSV_FIELDS_BASE = [
  "id", "uuid", "userId",
  "title", "concreteStep",
  "horizonLevel", "priority", "category",
  "timeEstimateMinutes", "deadlineTimestamp", "reminderAt",
  "isCompleted", "isParked", "isNowFocus", "isDeleted", "isMVD",
  "orderIndex", "dateCompletedString", "lastUpdated",
  "dayMapDate", "dayMapDurationMinutes", "dayMapOrder",
  "dayMapPeriod", "dayMapStartMinutes",
  "subSteps"
];

function buildCsvFields(tasks) {
  const known = new Set(CSV_FIELDS_BASE);
  const extra = new Set();
  for (const task of tasks) {
    for (const key of Object.keys(task)) {
      if (!known.has(key)) extra.add(key);
    }
  }
  return extra.size ? [...CSV_FIELDS_BASE, ...extra] : CSV_FIELDS_BASE;
}

function escapeCsvCell(value) {
  if (value === null || value === undefined) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function makeFilename(ext, prefix = "loci-tasks-backup") {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${prefix}-${date}-${time}.${ext}`;
}

export function buildPayloadBackupData(payload) {
  const safe = normalizePayload(payload);
  return {
    ...safe,
    app: "Loci",
    exportType: "full-payload-backup",
    exportedAt: new Date().toISOString(),
    taskCount: safe.tasks.length,
  };
}

export function exportTasksAsJson(tasks) {
  const data = {
    app: "Loci",
    exportType: "tasks-backup",
    exportedAt: new Date().toISOString(),
    taskCount: tasks.length,
    tasks
  };
  // No BOM — plain UTF-8 so strict JSON parsers (Python, Node, jq) can read it
  downloadBlob(JSON.stringify(data, null, 2), makeFilename("json"), "application/json;charset=utf-8");
}

export function exportTasksAsCsv(tasks) {
  const fields = buildCsvFields(tasks);
  const header = fields.join(",");
  const rows = tasks.map(task =>
    fields.map(field => escapeCsvCell(task[field])).join(",")
  );
  // BOM kept for CSV — Excel/Google Sheets needs it to detect UTF-8 correctly
  const content = "﻿" + [header, ...rows].join("\r\n");
  downloadBlob(content, makeFilename("csv"), "text/csv;charset=utf-8");
}

export function exportPayloadAsJson(payload) {
  const data = buildPayloadBackupData(payload);
  // No BOM — plain UTF-8 so strict JSON parsers (Python, Node, jq) can read it
  downloadBlob(JSON.stringify(data, null, 2), makeFilename("json", "loci-payload-backup"), "application/json;charset=utf-8");
}
