// Q59: the Day map page opens from the Day map view's From row ("Day map
// page ›"), or with M when the list is put away. Today then reopens on its
// List view, as these tests expect.
export async function openDayMapPage(page) {
  const view = page.getByRole("group", { name: "View" }).getByRole("button", { name: "Day map", exact: true });
  if (await view.isVisible()) {
    await view.click();
    await page.getByRole("button", { name: "Day map page ›" }).click();
  } else {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("m");
  }
  await page.locator(".day-map-page").waitFor();
  await page.evaluate(() => { try { window.localStorage.setItem("loci_today_view", "list"); } catch { /* private mode */ } });
}
