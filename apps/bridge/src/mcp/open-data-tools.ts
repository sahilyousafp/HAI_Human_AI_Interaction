import { OPEN_DATA_SOURCES, Site, STARTER_PORTALS } from "@hai/protocol";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { failure, text } from "./tool-results.ts";

/** One source as an agent is told about it. */
export interface OpenDataSourceStatus {
  id: string;
  name: string;
  hosts: readonly string[];
  provides: string;
  licence: string;
  /** Whether a request to it would be made now. */
  on: boolean;
  /** Why it is off, when it is. */
  why?: string;
}

/** What the open-data tools need of the app: which sources are on, and the project's site. */
export interface OpenDataTools {
  /** The sources and whether each may be contacted now. */
  sources(): OpenDataSourceStatus[];
  site(): Site | null;
  /** Saves a site the user approved (the approval card is shown before this runs). */
  setSite(site: Site): void;
}

/** The sources as Settings lists them, with whether each is on and the portal hosts that count. */
export function describeSources(
  allows: (id: string) => boolean,
  portalHosts: readonly string[],
): OpenDataSourceStatus[] {
  return OPEN_DATA_SOURCES.map((source) => {
    const on = allows(source.id);
    const hosts =
      source.id === "portals" ? [...STARTER_PORTALS.map((p) => p.host), ...portalHosts] : source.hosts;
    return {
      id: source.id,
      name: source.name,
      hosts,
      provides: source.provides,
      licence: source.licence,
      on,
      ...(on
        ? {}
        : {
            why: source.limit
              ? `off until the user acknowledges: ${source.limit}`
              : "switched off in Settings",
          }),
    };
  });
}

/** Registers `open_data_sources` and `site_set`; offered only while Open data is on. */
export function registerOpenDataTools(register: McpServer["registerTool"], deps: OpenDataTools): void {
  register(
    "open_data_sources",
    {
      description:
        "Says which open-data sources you may use now (name, hosts, what each provides, licence), and the project's site (latitude, longitude, true north) if it has one. Open data is the user's choice: a request carries only a place, an area, a time or a search text, never the model. Every result carries its source, licence, attribution and how old it is; say the source and the age when you report it.",
      inputSchema: z.object({}),
    },
    async () => {
      const site = deps.site();
      return text({
        site,
        ...(site
          ? {}
          : {
              note: "The project has no site yet. Ask the user for the place, then propose it with site_set.",
            }),
        sources: deps.sources(),
      });
    },
  );

  register(
    "site_set",
    {
      description:
        "Proposes the project's site: where the model's anchor point stands (latitude, longitude, degrees) and which way true north points. The user sees an approval card with the values and decides; nothing is saved until they allow it. Use it when the user names the place of the project. Open-data tools use the site to turn places into model coordinates (millimetres, +Y is north unless north_deg turns it).",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90).describe("Degrees, north positive"),
        longitude: z.number().min(-180).max(180).describe("Degrees, east positive"),
        north_deg: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe(
            "The angle of true north counter-clockwise from the model's +Y axis, degrees (default 0)",
          ),
        anchor_x_mm: z
          .number()
          .optional()
          .describe("The model x, in millimetres, that stands at this place (default 0)"),
        anchor_y_mm: z
          .number()
          .optional()
          .describe("The model y, in millimetres, that stands at this place (default 0)"),
      }),
    },
    async (input) => {
      const parsed = Site.safeParse({
        lat: input.latitude,
        lon: input.longitude,
        northDeg: input.north_deg ?? 0,
        anchorMm: [input.anchor_x_mm ?? 0, input.anchor_y_mm ?? 0],
      });
      if (!parsed.success)
        return failure(`The site was not set. ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      deps.setSite(parsed.data);
      return text({ site: parsed.data, status: "saved" });
    },
  );
}
