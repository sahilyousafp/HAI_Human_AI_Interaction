import { STRIP_ITEMS, STRIP_PRESETS, type StripItem, type StripLayout } from "@hai/protocol";
import { ListGroup, ListRow, Segmented, Switch } from "../ui/controls.tsx";

type Preset = StripLayout["preset"];

const PRESET_OPTIONS: ReadonlyArray<{ value: Preset; label: string; testId: string }> = [
  { value: "quiet", label: "Quiet", testId: "rail-preset-quiet" },
  { value: "needs-you", label: "Needs you first", testId: "rail-preset-needs-you" },
  { value: "team", label: "Team", testId: "rail-preset-team" },
  { value: "custom", label: "Custom", testId: "rail-preset-custom" },
];

const ITEM_TEXT: Record<StripItem, { label: string; detail: string }> = {
  waiting: {
    label: "Waiting for you",
    detail: "A count of requests that need an answer. Listed first, it takes over the strip while one waits.",
  },
  state: { label: "Working or idle", detail: "The agent's state, as a dot and a word." },
  team: {
    label: "Team dots",
    detail: "One dot for each agent, ringed while it works, with a number when it waits for you.",
  },
  name: { label: "Agent name", detail: "Who you are talking to." },
  lastLine: { label: "Last line of the reply", detail: "The end of the latest answer, in one line." },
  mic: {
    label: "Microphone",
    detail: "Always at the foot of the strip, so you can talk with the rail collapsed.",
  },
};

/**
 * Settings > Chat rail: what the collapsed rail shows and in what order of priority. A preset is a ready-made list;
 * changing the list by hand makes it Custom. When the strip is short, the items lower in the list drop off first.
 */
export function RailSettings({
  layout,
  onChange,
}: {
  layout: StripLayout;
  onChange(layout: StripLayout): void;
}) {
  const choose = (preset: Preset) =>
    onChange(
      preset === "custom" ? { preset, items: layout.items } : { preset, items: [...STRIP_PRESETS[preset]] },
    );
  const custom = (items: StripItem[]) => onChange({ preset: "custom", items });
  const move = (item: StripItem, by: -1 | 1) => {
    const at = layout.items.indexOf(item);
    const to = at + by;
    if (at < 0 || to < 0 || to >= layout.items.length) return;
    const items = [...layout.items];
    items.splice(at, 1);
    items.splice(to, 0, item);
    custom(items);
  };
  const toggle = (item: StripItem, on: boolean) =>
    custom(on ? [...layout.items, item] : layout.items.filter((i) => i !== item));
  const rows = [...layout.items, ...STRIP_ITEMS.filter((i) => !layout.items.includes(i))];
  return (
    <div className="settings-page-body" data-testid="rail-settings">
      <ListGroup
        title="When the chat is collapsed"
        footer="The strip shows what is ticked, top to bottom in this order. When it is short, the items lower down drop off first. A request that waits for you is also drawn in the model, whatever you choose here."
      >
        <ListRow
          label="Show"
          control={
            <Segmented
              label="Collapsed rail preset"
              wide
              value={layout.preset}
              options={PRESET_OPTIONS}
              onChange={choose}
              testId="rail-presets"
            />
          }
        />
      </ListGroup>
      <ListGroup title="Priority">
        {rows.map((item) => {
          const at = layout.items.indexOf(item);
          const on = at >= 0;
          return (
            <ListRow
              key={item}
              testId={`rail-item-${item}`}
              label={ITEM_TEXT[item].label}
              detail={ITEM_TEXT[item].detail}
              control={
                <span className="rail-item-controls">
                  {on && (
                    <>
                      <button
                        type="button"
                        className="icon-button"
                        data-testid={`rail-up-${item}`}
                        data-hand-press
                        aria-label={`Move ${ITEM_TEXT[item].label} up`}
                        disabled={at === 0}
                        onClick={() => move(item, -1)}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        data-testid={`rail-down-${item}`}
                        data-hand-press
                        aria-label={`Move ${ITEM_TEXT[item].label} down`}
                        disabled={at === layout.items.length - 1}
                        onClick={() => move(item, 1)}
                      >
                        ▼
                      </button>
                    </>
                  )}
                  <Switch
                    label={ITEM_TEXT[item].label}
                    testId={`rail-show-${item}`}
                    checked={on}
                    onChange={(next) => toggle(item, next)}
                  />
                </span>
              }
            />
          );
        })}
      </ListGroup>
    </div>
  );
}
