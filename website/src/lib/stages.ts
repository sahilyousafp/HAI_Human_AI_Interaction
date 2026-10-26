import { getCollection } from "astro:content";

/** All stages, in build order. */
export async function getStages() {
  return (await getCollection("stages")).sort((a, b) => a.data.order - b.data.order);
}
