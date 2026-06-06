export function formatCountdown(msLeft) {
  if (typeof msLeft !== "number" || isNaN(msLeft) || msLeft <= 0) return null;
  const totalSecs = Math.floor(msLeft / 1000);
  const dd = Math.floor(totalSecs / 86400);
  const hh = String(Math.floor((totalSecs % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSecs % 60).padStart(2, "0");
  return `${dd}d ${hh}h ${mm}m ${ss}s`;
}
