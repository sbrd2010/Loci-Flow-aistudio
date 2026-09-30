// Plan's ladder (57): open a horizon's rung. On a phone the open list hides
// the ladder, so go back to it first.
export async function openRung(page, id) {
  const back = page.locator(".plan-open-back");
  if (await back.isVisible()) await back.click();
  await page.locator(`.plan-rung[data-horizon='${id}']`).click();
}
