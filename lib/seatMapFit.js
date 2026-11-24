export const MIN_SEAT_MAP_SCALE = 0.75;
export const MAX_SEAT_MAP_SCALE = 1.25;

// Use the tighter axis so the entire map fits. Never shrink below the agreed minimum.
export function calculateSeatMapFit({ width, height, availableWidth, availableHeight, minScale = MIN_SEAT_MAP_SCALE, maxScale = MAX_SEAT_MAP_SCALE }) {
  const roomWidth = Math.max(1, Math.floor(Number(availableWidth) || 1));
  const roomHeight = Math.max(1, Math.floor(Number(availableHeight) || 1));
  const fittingScale = Math.floor(Math.min(roomWidth / width, roomHeight / height) * 1000) / 1000;
  const scale = Math.max(minScale, Math.min(maxScale, fittingScale));
  const scaledWidth = Math.ceil(width * scale);
  const scaledHeight = Math.ceil(height * scale);
  return {
    scale,
    scaledWidth,
    scaledHeight,
    viewportHeight: Math.min(roomHeight, scaledHeight),
    needsHorizontalScroll: scaledWidth > roomWidth,
    needsVerticalScroll: scaledHeight > roomHeight,
  };
}
