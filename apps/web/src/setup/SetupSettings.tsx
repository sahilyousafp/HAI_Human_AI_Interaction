import type { DesktopApi } from "@hai/protocol";
import { ListGroup, ListRow, Switch } from "../ui/controls.tsx";
import { claudeSummary } from "./claude-view.ts";
import { useClaudeSetup, useModelsState, useUpdateState } from "./FirstRun.tsx";
import { updatesView } from "./updates-view.ts";

const MODEL_SUMMARY = {
  checking: "Checking",
  ready: "Installed",
  needed: "Not downloaded",
  downloading: "Downloading",
  failed: "Download did not finish",
} as const;

/**
 * Settings > Setup, in the desktop app: where Claude Code and the voice models stand, and a button that opens the same
 * first-run screens again, whatever was skipped before.
 */
export function SetupSettings({ desktop, onOpen }: { desktop: DesktopApi; onOpen(): void }) {
  const claude = useClaudeSetup(desktop);
  const models = useModelsState(desktop);
  const updateState = useUpdateState(desktop);
  const update = updateState ? updatesView(updateState) : null;
  return (
    <div className="settings-page-body" data-testid="setup-settings">
      {desktop.updates && updateState && update && (
        <ListGroup
          title="Updates"
          testId="setup-updates"
          footer="When automatic checks are on, HAI asks its release page for the newest version when it starts and once a day, and sends nothing but what any web request carries. Nothing is downloaded until you press Download."
        >
          <ListRow
            label="HAI"
            detail={`Version ${updateState.current}`}
            control={
              <span className="list-value" data-testid="update-summary" data-tone={update.tone}>
                {update.summary}
              </span>
            }
          />
          {update.progress !== null && (
            <div className="setup-update-progress" data-testid="update-progress">
              <div
                className="first-run-progress"
                role="progressbar"
                aria-label="Update download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(update.progress * 100)}
              >
                <span
                  className="first-run-progress-fill"
                  style={{ width: `${Math.round(update.progress * 1000) / 10}%` }}
                />
              </div>
            </div>
          )}
          {update.detail && (
            <ListRow
              label={
                <span className="setup-update-detail" data-testid="update-detail">
                  {update.detail}
                </span>
              }
            />
          )}
          {update.action && (
            <ListRow
              label=" "
              control={
                <button
                  type="button"
                  className={update.action.id === "check" ? "secondary" : "primary"}
                  data-testid={`update-${update.action.id}`}
                  data-hand-press
                  disabled={update.action.disabled}
                  onClick={() => {
                    const api = desktop.updates;
                    const id = update.action?.id;
                    if (id === "check") api.check().catch(() => {});
                    else if (id === "download") api.download().catch(() => {});
                    else if (id === "restart") api.restart().catch(() => {});
                  }}
                >
                  {update.action.label}
                </button>
              }
            />
          )}
          {updateState.status !== "unavailable" && (
            <ListRow
              label="Check for updates automatically"
              control={
                <Switch
                  label="Check for updates automatically"
                  testId="update-auto"
                  checked={updateState.autoCheck}
                  onChange={(on) => {
                    desktop.updates.setAutoCheck(on).catch(() => {});
                  }}
                />
              }
            />
          )}
        </ListGroup>
      )}
      <ListGroup
        title="Status"
        footer="HAI runs the agent team on your own Claude Code, and the voice on models kept on this computer."
      >
        {desktop.claude && (
          <ListRow
            label="Claude Code"
            control={
              <span className="list-value" data-testid="setup-claude-status">
                {claudeSummary(claude)}
              </span>
            }
          />
        )}
        <ListRow
          label="Voice models"
          control={
            <span className="list-value" data-testid="setup-voice-status">
              {models ? MODEL_SUMMARY[models.status] : "Checking"}
            </span>
          }
        />
      </ListGroup>
      <ListGroup footer="Shows the setup screens again, for each step with where it stands now.">
        <ListRow
          label="Open setup"
          control={
            <button
              type="button"
              className="secondary"
              data-testid="setup-open"
              data-hand-press
              onClick={onOpen}
            >
              Open
            </button>
          }
        />
      </ListGroup>
    </div>
  );
}
