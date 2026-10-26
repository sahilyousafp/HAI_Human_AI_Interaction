import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// One entry per stage of the build. Add a stage: make its card preview (scripts/make-preview.mjs) and, if it
// has a recording, encode it (scripts/encode-video.mjs), then add a markdown file here. The slug is the file
// name and names the files in public/media/.
const stages = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/stages" }),
  schema: z
    .object({
      order: z.number().int().positive(),
      week: z.string(),
      title: z.string(),
      summary: z.string(),
      date: z.coerce.date(),
      // The stage's recording, if it has one.
      video: z
        .object({
          // Seconds, as printed by the encode script.
          duration: z.number().positive(),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
        })
        .optional(),
      // Stills shown instead of a recording, e.g. for a research week.
      images: z
        .array(
          z.object({
            src: z.string().startsWith("/"),
            alt: z.string(),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          }),
        )
        .optional(),
      highlights: z.array(z.string()).min(1),
      linkedin: z.object({
        url: z.url(),
        // The post's URN, e.g. urn:li:ugcPost:123. Drives the embed.
        urn: z.string().regex(/^urn:li:(ugcPost|share|activity):\d+$/),
        // The post's opening line, quoted on the card.
        hook: z.string(),
      }),
    })
    .refine((s) => s.video || s.images?.length, { message: "A stage needs a video or images." }),
});

export const collections = { stages };
