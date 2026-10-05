// The page's CSS zoom (Q59, 72: 1 below 1600px). Rects and pointer
// positions are in screen pixels, but a size written back into a style is
// multiplied by the zoom, so it divides by this first.
export function cssZoom() {
  if (typeof document === "undefined") return 1;
  const root = document.documentElement;
  return root.currentCSSZoom || Number.parseFloat(getComputedStyle(root).zoom) || 1;
}

// dnd-kit's transforms are screen-pixel deltas; applied to a zoomed element
// they would move it by delta × zoom.
export function unzoomTransform(transform) {
  if (!transform) return transform;
  const z = cssZoom();
  return z === 1 ? transform : { ...transform, x: transform.x / z, y: transform.y / z };
}
