// CSV field order — matches actual task object shape found in the data model.
// Unknown/extra fields on a task are preserved in JSON export; CSV uses this fixed list.
const CSV_FIELDS = [
  "id", "uuid", "userId",
  "title", "concreteStep",
  "horizonLevel", "priority", "category",
  "timeEstimateMinutes", "deadlineTimestamp", "reminderAt",
  "isCompleted", "isParked", "isNowFocus", "isDeleted",
  "orderIndex", "dateCompletedString", "lastUpdated",
  "subSteps"
];

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

function makeFilename(ext) {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `loci-tasks-backup-${date}-${time}.${ext}`;
}

export function exportTasksAsJson(tasks) {
  const data = {
    app: "Loci",
    exportType: "tasks-backup",
    exportedAt: new Date().toISOString(),
    taskCount: tasks.length,
    tasks
  };
  // "﻿" BOM ensures editors/spreadsheets read UTF-8 correctly
  downloadBlob("﻿" + JSON.stringify(data, null, 2), makeFilename("json"), "application/json;charset=utf-8");
}

export function exportTasksAsCsv(tasks) {
  const header = CSV_FIELDS.join(",");
  const rows = tasks.map(task =>
    CSV_FIELDS.map(field => escapeCsvCell(task[field])).join(",")
  );
  // "﻿" BOM makes Excel/Google Sheets handle UTF-8 titles without garbling
  const content = "﻿" + [header, ...rows].join("\r\n");
  downloadBlob(content, makeFilename("csv"), "text/csv;charset=utf-8");
}
