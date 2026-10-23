import type { ClaudeSetup, DesktopApi, ModelsState, UpdateState } from "@hai/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { ToolIcon } from "../tools/ToolOverlays.tsx";
import { type ClaudeAction, type ClaudeView, claudeView } from "./claude-view.ts";
import { type ModelsAction, type ModelsItemView, type ModelsView, modelsView } from "./models-view.ts";

const VOICE_SKIP_KEY = "hai.setup.voiceSkipped";
const CLAUDE_SKIP_KEY = "hai.setup.claudeSkipped";
const MIC_ICON = "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3";
const SPEAKER_ICON = "M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13";
const CHECK_ICON = "M5 12.5l4.5 4.5L19 7.5";
const WARN_ICON = "M12 4 3 20h18zM12 10v4M12 17h.01";

/** What each part is shown with: the icon of the voice feature it belongs to, in that feature's settings colour. */
const ITEM_ICONS: Record<string, { path: string; tint: string }> = {
  "moonshine-base": { path: MIC_ICON, tint: "var(--tint-red)" },
  kokoro: { path: SPEAKER_ICON, tint: "var(--tint-blue)" },
};

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked (private window): the choice holds for this visit only.
  }
}

/** The voice models' state from the desktop app, kept current. Null in a browser, where there is no desktop app. */
export function useModelsState(desktop: DesktopApi | undefined): ModelsState | null {
  const [state, setState] = useState<ModelsState | null>(null);
  useEffect(() => {
    if (!desktop) {
      setState(null);
      return;
    }
    let live = true;
    const stop = desktop.models.onChange((next) => {
      if (live) setState(next);
    });
    // An update that arrived before this answer is newer than it.
    desktop.models
      .state()
      .then((first) => {
        if (live) setState((current) => current ?? first);
      })
      .catch(() => {});
    return () => {
      live = false;
      stop();
    };
  }, [desktop]);
  return state;
}

/** Where Claude Code stands, from the desktop app, kept current. Null in a browser, and while the first answer is awaited. */
export function useClaudeSetup(desktop: DesktopApi | undefined): ClaudeSetup | null {
  const [setup, setSetup] = useState<ClaudeSetup | null>(null);
  const claude = desktop?.claude;
  useEffect(() => {
    if (!claude) {
      setSetup(null);
      return;
    }
    let live = true;
    const stop = claude.onChange((next) => {
      if (live) setSetup(next);
    });
    claude
      .state()
      .then((first) => {
        if (live) setSetup((current) => current ?? first);
      })
      .catch(() => {});
    return () => {
      live = false;
      stop();
    };
  }, [claude]);
  return setup;
}

/** Where updating stands, from the desktop app, kept current. Null in a browser, and while the first answer is awaited. */
export function useUpdateState(desktop: DesktopApi | undefined): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  const updates = desktop?.updates;
  useEffect(() => {
    if (!updates) {
      setState(null);
      return;
    }
    let live = true;
    const stop = updates.onChange((next) => {
      if (live) setState(next);
    });
    updates
      .state()
      .then((first) => {
        if (live) setState((current) => current ?? first);
      })
      .catch(() => {});
    return () => {
      live = false;
      stop();
    };
  }, [updates]);
  return state;
}

/** The step to show: Claude Code comes first, then the voice models, then nothing. */
function currentStep(claudeVisible: boolean, voiceVisible: boolean): "claude" | "voice" | null {
  if (claudeVisible) return "claude";
  if (voiceVisible) return "voice";
  return null;
}

function ItemRow({ item }: { item: ModelsItemView }) {
  const icon = ITEM_ICONS[item.id];
  return (
    <li className="first-run-item" data-testid={`first-run-item-${item.id}`} data-state={item.state}>
      <span
        className="settings-icon"
        style={{ background: icon?.tint ?? "var(--tint-gray)" }}
        aria-hidden="true"
      >
        <ToolIcon path={icon?.path ?? MIC_ICON} size={16} />
      </span>
      <span className="first-run-item-text">
        <span className="first-run-item-title">{item.title}</span>
        <span className="first-run-item-detail">{item.detail}</span>
      </span>
      <span className="first-run-item-size">
        {item.state === "done" ? <ToolIcon path={CHECK_ICON} size={16} /> : item.size}
      </span>
    </li>
  );
}

interface Chrome {
  tone: string;
  headline: string;
  detail: string;
  kicker: string;
  step: "claude" | "voice";
  primary: React.RefObject<HTMLButtonElement | null>;
  children?: React.ReactNode;
  actions: { id: string; label: string; primary: boolean; disabled?: boolean }[];
  onAction(id: string): void;
}

/** The card every step shares: kicker, headline, what it means, its own content, and its buttons. */
function Card({ tone, headline, detail, kicker, step, primary, children, actions, onAction }: Chrome) {
  return (
    <div className="first-run" data-testid="first-run" data-tone={tone} data-step={step}>
      <section className="first-run-card" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
        <p className="first-run-kicker">{kicker}</p>
        <h1 className="first-run-title" id="first-run-title" data-testid="first-run-headline">
          {headline}
        </h1>
        <p className="first-run-detail" data-testid="first-run-detail">
          {detail}
        </p>
        {children}
        <div className="first-run-actions">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              ref={action.primary ? primary : undefined}
              className={action.primary ? "primary" : "secondary"}
              data-testid={`first-run-action-${action.id}`}
              data-hand-press
              disabled={action.disabled}
              onClick={() => onAction(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ModelsBody({ view }: { view: ModelsView }) {
  return (
    <>
      {view.items.length > 0 && (
        <ul className="first-run-items" data-testid="first-run-items">
          {view.items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
      {view.progress !== null && (
        <div className="first-run-progress-block">
          <div
            className="first-run-progress"
            role="progressbar"
            aria-label="Download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(view.progress * 100)}
            data-testid="first-run-progress"
          >
            <span
              className="first-run-progress-fill"
              style={{ width: `${Math.round(view.progress * 1000) / 10}%` }}
            />
          </div>
        </div>
      )}
      {view.progressLabel && (
        <p className="first-run-progress-label" data-testid="first-run-progress-label" aria-live="polite">
          {view.progressLabel}
        </p>
      )}
    </>
  );
}

function ClaudeBody({ view }: { view: ClaudeView }) {
  const outputEnd = useRef<HTMLPreElement>(null);
  // Keep the newest line of the installer's output in sight.
  const lastLine = view.output.at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls when a line arrives; `lastLine` is the trigger.
  useEffect(() => {
    const el = outputEnd.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastLine]);
  return (
    <>
      {view.prerequisites.length > 0 && (
        <ul className="first-run-items" data-testid="first-run-prerequisites">
          {view.prerequisites.map((p) => (
            <li
              key={p.id}
              className="first-run-item"
              data-testid={`first-run-prerequisite-${p.id}`}
              data-state={p.ok ? "done" : "waiting"}
            >
              <span
                className="settings-icon"
                style={{ background: p.ok ? "var(--tint-green)" : "var(--tint-orange)" }}
                aria-hidden="true"
              >
                <ToolIcon path={p.ok ? CHECK_ICON : WARN_ICON} size={16} />
              </span>
              <span className="first-run-item-text">
                <span className="first-run-item-title">{p.label}</span>
                <span className="first-run-item-detail">{p.why}</span>
              </span>
              <span className="first-run-item-size">{p.ok ? "Ready" : "Needed"}</span>
            </li>
          ))}
        </ul>
      )}
      {view.command && (
        <div className="first-run-command" data-testid="first-run-command-block">
          <p className="first-run-command-label">If you press Install, HAI runs this, and nothing else:</p>
          <code className="first-run-command-text" data-testid="first-run-command">
            {view.command.command}
          </code>
          <p className="first-run-command-source">
            It downloads Anthropic's installer from{" "}
            <span data-testid="first-run-source">{view.command.source}</span> and installs Claude Code for
            your user account only. It does not need administrator rights.
          </p>
        </div>
      )}
      {view.working && (
        <div className="first-run-progress-block">
          <div
            className="first-run-progress"
            role="progressbar"
            aria-label={view.headline}
            data-indeterminate="true"
          >
            <span className="first-run-progress-fill first-run-progress-indeterminate" />
          </div>
        </div>
      )}
      {view.output.length > 0 && (
        <pre className="first-run-output" data-testid="first-run-output" ref={outputEnd} aria-live="off">
          {view.output.join("\n")}
        </pre>
      )}
      {view.manualUrl && (
        <p className="first-run-manual">
          Prefer to do it yourself?{" "}
          <a href={view.manualUrl} target="_blank" rel="noreferrer" data-testid="first-run-manual">
            Claude Code's own instructions
          </a>
        </p>
      )}
    </>
  );
}

/**
 * The screens a first-time desktop user meets, one after the other: Claude Code (installed and signed in, with the
 * user's agreement and in Claude Code's own windows), then the voice models to download. They exist only inside the
 * desktop app (the page has no `haiDesktop` in a browser) and only while something is missing. A step the user skips is
 * remembered, so it does not return at every launch; `forced` shows every step again, with its present state, so the
 * user can open the same setup from Settings.
 */
export function FirstRun({
  desktop,
  forced = false,
  onClose,
}: {
  desktop: DesktopApi | undefined;
  /** Show every step (Settings > Setup), whatever was skipped or is already done. */
  forced?: boolean;
  /** Called when a forced run has been through its last step. */
  onClose?: () => void;
}) {
  const claude = useClaudeSetup(desktop);
  const models = useModelsState(desktop);
  const hasClaude = Boolean(desktop?.claude);
  const [claudeDone, setClaudeDone] = useState(false);
  const [voiceDone, setVoiceDone] = useState(false);
  const [claudeSkipped, setClaudeSkipped] = useState(() => readFlag(CLAUDE_SKIP_KEY));
  const [voiceSkipped, setVoiceSkipped] = useState(() => readFlag(VOICE_SKIP_KEY));
  // Whether this visit saw something missing, so that finishing it can say so instead of vanishing.
  const sawClaudeWork = useRef(false);
  const sawVoiceWork = useRef(false);
  const primary = useRef<HTMLButtonElement>(null);

  // Opening the setup again starts it from the first step. Done while rendering, not in an effect: an effect would run
  // after the "this run is over" check below had already seen the old flags and closed it again.
  const [wasForced, setWasForced] = useState(forced);
  if (forced !== wasForced) {
    setWasForced(forced);
    if (forced) {
      setClaudeDone(false);
      setVoiceDone(false);
    }
  }

  const claudeStatus = claude?.state.status;
  const claudeNeedsWork =
    claudeStatus !== undefined && claudeStatus !== "ready" && claudeStatus !== "checking";
  useEffect(() => {
    if (claudeNeedsWork) sawClaudeWork.current = true;
  }, [claudeNeedsWork]);
  const modelsNeedWork = models !== null && models.status !== "ready" && models.status !== "checking";
  useEffect(() => {
    if (modelsNeedWork) sawVoiceWork.current = true;
  }, [modelsNeedWork]);

  const cView = claude ? claudeView(claude) : null;
  const vView = models ? modelsView(models) : null;

  const claudeVisible =
    hasClaude &&
    cView !== null &&
    !claudeDone &&
    (forced || (claudeStatus === "ready" ? sawClaudeWork.current : !claudeSkipped));
  const voiceVisible =
    vView !== null &&
    !voiceDone &&
    (forced || (models?.status === "ready" ? sawVoiceWork.current : !voiceSkipped));
  const step = currentStep(claudeVisible, voiceVisible);

  // A forced run is over when it has been through every step it has.
  const waiting = (hasClaude && cView === null && !claudeDone) || (vView === null && !voiceDone);
  useEffect(() => {
    if (forced && step === null && !waiting) onClose?.();
  }, [forced, step, waiting, onClose]);

  // Put the keyboard on the main choice whenever the screen changes what it asks.
  const headline = step === "claude" ? cView?.headline : vView?.headline;
  useEffect(() => {
    if (step && headline) primary.current?.focus();
  }, [step, headline]);

  const actClaude = useCallback(
    (id: ClaudeAction) => {
      const api = desktop?.claude;
      if (!api) return;
      switch (id) {
        case "install":
          writeFlag(CLAUDE_SKIP_KEY, false);
          setClaudeSkipped(false);
          api.install().catch(() => {});
          break;
        case "signin":
          api.openSignIn().catch(() => {});
          break;
        case "recheck":
          api.recheck().catch(() => {});
          break;
        case "skip":
          writeFlag(CLAUDE_SKIP_KEY, true);
          setClaudeSkipped(true);
          setClaudeDone(true);
          break;
        case "continue":
          setClaudeDone(true);
          break;
      }
    },
    [desktop],
  );

  const actVoice = useCallback(
    (id: ModelsAction) => {
      if (!desktop) return;
      switch (id) {
        case "download":
        case "retry":
          writeFlag(VOICE_SKIP_KEY, false);
          setVoiceSkipped(false);
          desktop.models.start().catch(() => {});
          break;
        case "continue":
          setVoiceDone(true);
          break;
        case "skip":
          writeFlag(VOICE_SKIP_KEY, true);
          setVoiceSkipped(true);
          setVoiceDone(true);
          break;
        case "cancel":
          desktop.models.cancel().catch(() => {});
          break;
      }
    },
    [desktop],
  );

  if (step === null) return null;
  const kicker = hasClaude ? `Setting up HAI · Step ${step === "claude" ? 1 : 2} of 2` : "Setting up HAI";
  if (step === "claude" && cView) {
    return (
      <Card
        tone={cView.tone}
        headline={cView.headline}
        detail={cView.detail}
        kicker={kicker}
        step="claude"
        primary={primary}
        actions={cView.actions}
        onAction={(id) => actClaude(id as ClaudeAction)}
      >
        <ClaudeBody view={cView} />
      </Card>
    );
  }
  if (vView) {
    return (
      <Card
        tone={vView.tone}
        headline={vView.headline}
        detail={vView.detail}
        kicker={kicker}
        step="voice"
        primary={primary}
        actions={vView.actions}
        onAction={(id) => actVoice(id as ModelsAction)}
      >
        <ModelsBody view={vView} />
      </Card>
    );
  }
  return null;
}
