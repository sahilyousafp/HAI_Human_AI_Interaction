/** An item this many times the size of the model's typical one is a backdrop: a sky dome, a landscape. */
const BACKDROP_FACTOR = 8;
/** With fewer items than this there is no telling what is typical, and all of them are kept. */
const BACKDROP_MIN_ITEMS = 5;

/**
 * What to bring into view on opening a model: all of it but any backdrop. A sky dome kilometres across would leave the
 * building a speck, and would put the camera's target high in the air, where zooming in never reaches the model.
 */
export function withoutBackdrops<T>(items: T[], sizeOf: (item: T) => number): T[] {
  if (items.length < BACKDROP_MIN_ITEMS) return items;
  const sizes = items.map(sizeOf);
  const typical = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)] as number;
  return items.filter((_, i) => (sizes[i] as number) <= typical * BACKDROP_FACTOR);
}
