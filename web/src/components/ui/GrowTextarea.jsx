import React, { forwardRef, useCallback, useLayoutEffect, useRef } from "react";

// Try-out 4/5/7: a text field that wraps and grows instead of scrolling
// sideways — a thought, a title, a step. It grows to maxRows lines, then
// scrolls inside. Enter calls onEnter. Thoughts, titles and steps are
// stored as one line, so by default Shift+Enter does nothing and a pasted
// line break becomes a space (Codex review of #499); allowNewlines is for
// a field whose text keeps its lines.
const GrowTextarea = forwardRef(function GrowTextarea(
  { value, onChange, onEnter, onKeyDown, allowNewlines = false, maxRows = 6, rows = 1, style, ...rest },
  outerRef,
) {
  const innerRef = useRef(null);
  const setRef = useCallback((el) => {
    innerRef.current = el;
    if (typeof outerRef === "function") outerRef(el);
    else if (outerRef) outerRef.current = el;
  }, [outerRef]);

  const fit = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const line = Number.parseFloat(cs.lineHeight) || Number.parseFloat(cs.fontSize) * 1.4 || 20;
    const chrome = (Number.parseFloat(cs.paddingTop) || 0) + (Number.parseFloat(cs.paddingBottom) || 0)
      + (Number.parseFloat(cs.borderTopWidth) || 0) + (Number.parseFloat(cs.borderBottomWidth) || 0);
    const max = line * maxRows + chrome;
    // scrollHeight leaves out the borders.
    const full = el.scrollHeight + (Number.parseFloat(cs.borderTopWidth) || 0) + (Number.parseFloat(cs.borderBottomWidth) || 0);
    el.style.height = `${Math.min(full, max)}px`;
    el.style.overflowY = full > max + 1 ? "auto" : "hidden";
  }, [maxRows]);

  useLayoutEffect(() => { fit(); }, [value, fit]);
  useLayoutEffect(() => {
    // Fonts and the page's width settle after the first paint.
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== lastWidth) { lastWidth = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  return (
    <textarea
      ref={setRef}
      rows={rows}
      value={value}
      style={{ resize: "none", ...style }}
      onChange={(e) => {
        if (!allowNewlines && /[\r\n]/.test(e.target.value)) e.target.value = e.target.value.replace(/\s*[\r\n]+\s*/g, " ");
        onChange?.(e);
        fit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey) {
          if (allowNewlines && e.shiftKey) { onKeyDown?.(e); return; }
          e.preventDefault();
          if (!e.shiftKey) onEnter?.(e);
          return;
        }
        onKeyDown?.(e);
      }}
      {...rest}
    />
  );
});

export default GrowTextarea;
