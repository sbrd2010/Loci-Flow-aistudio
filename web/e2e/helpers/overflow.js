// Try-out 16/21/28: a box that scrolls sideways because a child is a few px
// too wide shows a stray grey bar. Lists every element that would scroll
// sideways (and the page itself), so a test can expect none.
export function sidewaysScrollers(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const out = doc.scrollWidth > doc.clientWidth ? [`page ${doc.scrollWidth} > ${doc.clientWidth}`] : [];
    for (const el of document.querySelectorAll("body *")) {
      if (!/auto|scroll/.test(getComputedStyle(el).overflowX) || el.scrollWidth <= el.clientWidth) continue;
      out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} ${el.scrollWidth} > ${el.clientWidth}`);
    }
    return out;
  });
}
