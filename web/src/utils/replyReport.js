// What a "Report" on a Coach reply attaches to the bug report: the tester's
// message and the reply, inside the 2,000 characters /bugReports allows for
// `steps` (database.rules.json). The reply is the point, so it keeps the room.
export const REPORT_FIELD_MAX = 2000;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function replyReportContext(userText, replyText) {
  const reply = String(replyText || "").trim();
  const asked = String(userText || "").trim();
  const replyPart = `Coach reply:\n${clip(reply, 1400)}`;
  if (!asked) return replyPart;
  const room = REPORT_FIELD_MAX - replyPart.length - "Your message:\n\n\n".length;
  return `Your message:\n${clip(asked, Math.max(1, room))}\n\n${replyPart}`;
}
