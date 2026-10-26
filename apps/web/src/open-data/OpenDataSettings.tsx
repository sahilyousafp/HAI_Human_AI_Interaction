import { OPEN_DATA_SOURCES, PortalHost, Site, STARTER_PORTALS } from "@hai/protocol";
import { useState, useSyncExternalStore } from "react";
import type { FeatureFlags } from "../settings/feature-flags.ts";
import { ListGroup, ListRow, Switch } from "../ui/controls.tsx";
import type { OpenDataStore } from "./open-data-store.ts";

/** A decimal as the user types it: empty or unparseable is no number. */
const number = (text: string): number | null => {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(value) ? value : null;
};

/** The site as entered, or why it cannot be saved. */
export function parseSiteFields(fields: {
  lat: string;
  lon: string;
  north: string;
  x: string;
  y: string;
}): { ok: true; site: Site } | { ok: false; error: string } {
  const lat = number(fields.lat);
  const lon = number(fields.lon);
  if (lat === null || lon === null)
    return { ok: false, error: "Latitude and longitude are numbers, in degrees." };
  const parsed = Site.safeParse({
    lat,
    lon,
    northDeg: number(fields.north) ?? 0,
    anchorMm: [number(fields.x) ?? 0, number(fields.y) ?? 0],
  });
  if (parsed.success) return { ok: true, site: parsed.data };
  const issue = parsed.error.issues[0];
  const key = issue?.path[0];
  const where = key === "lat" ? "Latitude" : key === "lon" ? "Longitude" : "North angle";
  const limit = key === "lat" ? 90 : 180;
  return { ok: false, error: `${where} must be from -${limit} to ${limit} degrees.` };
}

function SiteForm({ store }: { store: OpenDataStore }) {
  const { site } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [fields, setFields] = useState({
    lat: site ? String(site.lat) : "",
    lon: site ? String(site.lon) : "",
    north: site ? String(site.northDeg) : "0",
    x: site ? String(site.anchorMm[0]) : "0",
    y: site ? String(site.anchorMm[1]) : "0",
  });
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof typeof fields, label: string, unit: string, testId: string) => (
    <label className="settings-field">
      <span>
        {label} <span className="muted">{unit}</span>
      </span>
      <input
        className="settings-input"
        inputMode="decimal"
        data-testid={testId}
        value={fields[key]}
        onChange={(e) => {
          setFields({ ...fields, [key]: e.target.value });
          setError(null);
        }}
      />
    </label>
  );
  return (
    <ListGroup
      title="Site"
      testId="site-form"
      footer="Where the model's anchor point stands on Earth. Open-data tools use it to turn places into model coordinates (north is +Y, turned by the north angle). It is saved with the project."
    >
      <div className="list-row settings-fields">
        {field("lat", "Latitude", "degrees", "site-lat")}
        {field("lon", "Longitude", "degrees", "site-lon")}
        {field("north", "True north", "degrees from +Y", "site-north")}
        {field("x", "Anchor x", "mm", "site-x")}
        {field("y", "Anchor y", "mm", "site-y")}
      </div>
      <div className="list-row settings-actions">
        <button
          type="button"
          className="primary"
          data-testid="site-save"
          data-hand-press
          onClick={() => {
            const result = parseSiteFields(fields);
            if (result.ok) store.setSite(result.site);
            else setError(result.error);
          }}
        >
          Save site
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="site-clear"
          data-hand-press
          disabled={!site}
          onClick={() => {
            store.setSite(null);
            setFields({ lat: "", lon: "", north: "0", x: "0", y: "0" });
          }}
        >
          Clear site
        </button>
        <span className="settings-status" data-testid="site-state" role="status">
          {error ?? (site ? `Saved: ${site.lat}, ${site.lon}` : "No site yet")}
        </span>
      </div>
    </ListGroup>
  );
}

function PortalList({ store }: { store: OpenDataStore }) {
  const { portalHosts } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const parsed = PortalHost.safeParse(draft);
    if (!parsed.success) {
      setError("A host name such as data.example.org (no https://, no path).");
      return;
    }
    if (!portalHosts.includes(parsed.data)) store.setPortalHosts([...portalHosts, parsed.data]);
    setDraft("");
    setError(null);
  };
  return (
    <ListGroup
      title="Portals"
      testId="portal-list"
      footer="Agents may search the catalogues of these hosts (CKAN, Socrata or ArcGIS Hub) and no others. The starter list is ours; add a city or country portal of your own."
    >
      {STARTER_PORTALS.map((portal) => (
        <ListRow key={portal.host} label={portal.host} detail={`${portal.kind} (starter list)`} />
      ))}
      {portalHosts.map((host) => (
        <ListRow
          key={host}
          label={host}
          detail="added by you"
          control={
            <button
              type="button"
              className="secondary"
              data-testid={`portal-remove-${host}`}
              data-hand-press
              onClick={() => store.setPortalHosts(portalHosts.filter((h) => h !== host))}
            >
              Remove
            </button>
          }
        />
      ))}
      <div className="list-row settings-actions">
        <input
          className="settings-input"
          aria-label="Portal host"
          placeholder="data.example.org"
          data-testid="portal-input"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" className="secondary" data-testid="portal-add" data-hand-press onClick={add}>
          Add
        </button>
        {error && (
          <span className="settings-status" role="alert" data-testid="portal-error">
            {error}
          </span>
        )}
      </div>
    </ListGroup>
  );
}

const when = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * Settings > Open data: the switch, every source the app can contact with its hosts and licence, the portals, the
 * project's site, and the list of what was contacted. Nothing is fetched while the switch is off.
 */
export function OpenDataSettings({ store, flags }: { store: OpenDataStore; flags: FeatureFlags }) {
  const features = useSyncExternalStore(flags.subscribe, flags.getSnapshot);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const on = features.openData;
  return (
    <div className="settings-page-body" data-testid="open-data-settings">
      <ListGroup footer="Off by default. While it is on, your agents may read open data about the place: portals, buildings, vegetation, weather and ground temperature. A request carries a place, an area, a time or a search text, never your model, names or pictures. Every result says where it came from and how old it is.">
        <ListRow
          label="Open data"
          detail={on ? "Agents may use the sources below." : "Nothing is fetched."}
          control={
            <Switch
              label="Open data"
              testId="open-data-switch"
              checked={on}
              onChange={(next) => flags.set("openData", next)}
            />
          }
        />
        <ListRow
          label="Show context"
          detail="Draw the buildings, trees and ground data agents fetched. Their own pictures always include it."
          control={
            <Switch
              label="Show context"
              testId="show-context"
              checked={state.showContext}
              onChange={(next) => store.setShowContext(next)}
            />
          }
        />
      </ListGroup>
      <ListGroup title="Sources" testId="open-data-sources">
        {OPEN_DATA_SOURCES.map((source) => {
          const limited = source.limit && !state.acknowledged.includes(source.id);
          const hosts = source.id === "portals" ? "portals below" : source.hosts.join(", ");
          return (
            <ListRow
              key={source.id}
              label={source.name}
              testId={`source-${source.id}`}
              detail={
                <>
                  {source.provides}. {hosts}. {source.licence}.
                  {limited && <span className="settings-limit"> {source.limit}</span>}
                </>
              }
              control={
                limited ? (
                  <button
                    type="button"
                    className="secondary"
                    data-testid={`source-ack-${source.id}`}
                    data-hand-press
                    onClick={() => store.acknowledge(source.id)}
                  >
                    I understand
                  </button>
                ) : (
                  <Switch
                    label={source.name}
                    testId={`source-switch-${source.id}`}
                    checked={state.sources[source.id] !== false}
                    onChange={(next) => store.setSource(source.id, next)}
                  />
                )
              }
            />
          );
        })}
      </ListGroup>
      <PortalList store={store} />
      <SiteForm store={store} />
      <ListGroup
        title="Requests this session"
        testId="open-data-record"
        footer="The hosts that were contacted. The saved answers (cache) are kept in the workspace."
      >
        {state.record.length === 0 && <ListRow label="None yet" />}
        {[...state.record]
          .reverse()
          .slice(0, 50)
          .map((entry, i) => (
            <ListRow
              // biome-ignore lint/suspicious/noArrayIndexKey: entries have no id; the list is read-only and newest-first
              key={`${entry.at}-${i}`}
              label={`${when(entry.at)} ${entry.host || entry.source}`}
              detail={`${entry.kind}${entry.cached ? ", from the saved answers" : ""}${
                entry.error ? `, failed: ${entry.error}` : `, ${entry.bytes} bytes`
              }`}
            />
          ))}
        {state.record.length > 0 && (
          <div className="list-row settings-actions">
            <button
              type="button"
              className="secondary"
              data-testid="open-data-clear"
              data-hand-press
              onClick={() => store.clearRecord()}
            >
              Clear the list
            </button>
          </div>
        )}
      </ListGroup>
    </div>
  );
}
