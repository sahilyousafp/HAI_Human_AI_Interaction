import { type Element, type SceneDocument, type SceneOp, TAG_PART, type TaskScope } from "@hai/protocol";
import {
  type BoundsMm,
  describeScope,
  elementBounds,
  partIncludes,
  regionsOverlap,
  scopeCovers,
} from "@hai/scene";

export { describeScope };

/** What one running task may change. `scope` null is the whole model, as a task without a scope claims. */
export interface Claim {
  taskId: string;
  agent: string;
  title: string;
  scope: TaskScope | null;
  /** When it was granted, so an element two claims could both hold belongs to the earlier. */
  order: number;
  /** A worker's claim is cut from its parent's: the parent task's id. The parent keeps the rest. */
  parent?: string;
}

export type ClaimCheck = { ok: true } | { ok: false; error: string };

/**
 * Which part of the model each running task may change, and who holds what. It is the one place that answers
 * "may this agent change this element", so the scheduler (do two tasks overlap) and the scene tools (is this change
 * inside the claim) cannot disagree. Claims live as long as their task and are never saved.
 */
export class ClaimTable {
  private readonly claims = new Map<string, Claim>();
  private granted = 0;
  /** Elements the user changed while a task held them, per task, until that task's next read of them. */
  private readonly changedByUser = new Map<string, Set<string>>();
  /** Files a task's scripts will write, by lower-case path, until the task ends. */
  private readonly outputs = new Map<
    string,
    { taskId: string; agent: string; title: string; path: string }
  >();

  grant(claim: Omit<Claim, "order">): Claim {
    const granted = { ...claim, order: this.granted++ };
    this.claims.set(claim.taskId, granted);
    return granted;
  }

  /** Changes what a running claim takes in (the agent asked for more, or gave some back). */
  rescope(taskId: string, scope: TaskScope): void {
    const claim = this.claims.get(taskId);
    if (claim) this.claims.set(taskId, { ...claim, scope });
  }

  release(taskId: string): void {
    this.claims.delete(taskId);
    this.changedByUser.delete(taskId);
    for (const [key, held] of this.outputs) if (held.taskId === taskId) this.outputs.delete(key);
  }

  /**
   * Reserves the files a script will write for a task. All or nothing: when another task has reserved one of them
   * the answer names it. A task may reserve the same file again.
   */
  reserve(
    owner: Pick<Claim, "taskId" | "agent" | "title">,
    paths: string[],
  ): { ok: true } | { ok: false; error: string } {
    for (const path of paths) {
      const held = this.outputs.get(path.toLowerCase());
      if (held && held.taskId !== owner.taskId) {
        return {
          ok: false,
          error: `"${path}" is reserved by ${held.agent}'s task "${held.title}", which will write it. Nothing was run. Choose another file name, or wait for that task to end.`,
        };
      }
    }
    for (const path of paths)
      this.outputs.set(path.toLowerCase(), {
        taskId: owner.taskId,
        agent: owner.agent,
        title: owner.title,
        path,
      });
    return { ok: true };
  }

  /** Drops every claim (the project changed, so no running task is left). */
  clear(): void {
    this.claims.clear();
    this.changedByUser.clear();
    this.outputs.clear();
  }

  get all(): Claim[] {
    return [...this.claims.values()];
  }

  /** The running task of this agent, which is the claim it works under. */
  forAgent(agent: string): Claim | undefined {
    return this.all.find((c) => c.agent === agent);
  }

  /** Whether a claim takes in an element. `fresh` is an element about to be created, which must lie wholly inside. */
  covers(claim: Pick<Claim, "scope">, element: Element, doc: SceneDocument, fresh = false): boolean {
    return this.coversObject(claim, element.id, element.tags, elementBounds(element, doc.levels), fresh);
  }

  /** The same for anything with an id, tags and a box, such as a Rhino object. */
  coversObject(
    claim: Pick<Claim, "scope">,
    id: string,
    tags: Record<string, string> | undefined,
    bounds: BoundsMm | null,
    fresh = false,
  ): boolean {
    return scopeCovers(claim.scope, id, tags, bounds, fresh);
  }

  /** Whether two scopes could change the same element. A scope that is the whole model overlaps everything. */
  overlap(a: TaskScope | null, b: TaskScope | null, doc: SceneDocument): boolean {
    if (!a || !b) return true;
    if (
      a.part !== undefined &&
      b.part !== undefined &&
      (partIncludes(a.part, b.part) || partIncludes(b.part, a.part))
    )
      return true;
    if (a.ids && b.ids && a.ids.some((id) => b.ids?.includes(id))) return true;
    if (a.region && b.region && regionsOverlap(a.region, b.region)) return true;
    return this.reaches(a, b, doc) || this.reaches(b, a, doc);
  }

  /** Whether a scope's listed ids, or the elements of its part, are taken in by the other scope. */
  private reaches(from: TaskScope, into: TaskScope, doc: SceneDocument): boolean {
    const target = { scope: into };
    for (const id of from.ids ?? []) {
      const element = doc.elements[id];
      if (element && this.covers(target, element, doc)) return true;
    }
    if (from.part !== undefined && (into.ids || into.region)) {
      for (const element of Object.values(doc.elements)) {
        if (partIncludes(from.part, element.tags?.[TAG_PART]) && this.covers(target, element, doc))
          return true;
      }
    }
    return false;
  }

  /** Whether `claim` is cut, directly or through others, from the claim of task `ancestor`. */
  isBelow(claim: Claim, ancestor: string): boolean {
    for (let parent = claim.parent; parent !== undefined; parent = this.claims.get(parent)?.parent) {
      if (parent === ancestor) return true;
    }
    return false;
  }

  /** The claims of the running workers cut from `taskId`'s, directly or through others. */
  below(taskId: string): Claim[] {
    return this.all.filter((c) => this.isBelow(c, taskId));
  }

  /**
   * The claim that holds this element against `own`: the earliest-granted claim that takes it in, except `own`'s
   * parents (a worker works inside its parent's claim, so that is no conflict). A claim cut from `own` holds what it
   * was given whatever its order, so a parent cannot change a part while its worker runs. With no `own`, anyone's.
   */
  holder(element: Element, doc: SceneDocument, own?: Claim): Claim | undefined {
    const covering = this.all.filter((c) => c.taskId !== own?.taskId && this.covers(c, element, doc));
    const earliest = (claims: Claim[]) => claims.sort((a, b) => a.order - b.order)[0];
    if (!own) return earliest(covering);
    const below = covering.filter((c) => this.isBelow(c, own.taskId));
    if (below.length > 0) return earliest(below);
    const parents = new Set<string>();
    for (let parent = own.parent; parent !== undefined; parent = this.claims.get(parent)?.parent)
      parents.add(parent);
    return earliest(covering.filter((c) => !parents.has(c.taskId)));
  }

  /** The running claim that overlaps this scope, if any (what a queued task waits for). */
  blocking(scope: TaskScope | null, doc: SceneDocument, among: Iterable<Claim> = this.claims.values()) {
    for (const claim of among) if (this.overlap(scope, claim.scope, doc)) return claim;
    return undefined;
  }

  /**
   * Checks a batch against the calling task's claim and everyone else's. The whole batch is refused when any element
   * is outside the claim or held by another task; the message names the element, the holder and what to do.
   */
  check(own: Claim, ops: SceneOp[], doc: SceneDocument): ClaimCheck {
    const made = new Set<string>();
    const problems: string[] = [];
    for (const op of ops) {
      if (op.op === "create") {
        const element = op.element;
        made.add(element.id);
        if (!this.covers(own, element, doc, true)) {
          problems.push(
            `"${element.id}" would be outside your claim (${describeScope(own.scope)}), so it cannot be created`,
          );
          continue;
        }
        const held = this.holder(element, doc, own);
        if (held) problems.push(this.heldBy(element.id, held));
        continue;
      }
      if (made.has(op.id)) continue;
      const element = doc.elements[op.id];
      // A missing element is the scene's error to report, with its own wording.
      if (!element) continue;
      if (!this.covers(own, element, doc)) {
        const held = this.holder(element, doc, own);
        problems.push(
          held
            ? this.heldBy(element.id, held)
            : `"${element.id}" is outside your claim (${describeScope(own.scope)})`,
        );
        continue;
      }
      const held = this.holder(element, doc, own);
      // An earlier claim holds it, and so does a worker cut from this claim, whatever its order.
      if (held && (held.order < own.order || this.isBelow(held, own.taskId)))
        problems.push(this.heldBy(element.id, held));
    }
    if (problems.length === 0) return { ok: true };
    const first = problems[0] as string;
    const rest = problems.length > 1 ? ` (and ${problems.length - 1} more)` : "";
    return {
      ok: false,
      error: `Nothing was changed: ${first}${rest}. You can ask for more with request_claim, leave it to its owner, or tell the user.`,
    };
  }

  private heldBy(id: string, claim: Claim): string {
    return `"${id}" is claimed by ${claim.agent}'s task "${claim.title}" (${describeScope(claim.scope)})`;
  }

  /** The user changed these elements: any running task whose claim takes them in hears about it at its next read. */
  noteUserChange(ids: string[], before: SceneDocument, after: SceneDocument): void {
    for (const id of ids) {
      const element = before.elements[id] ?? after.elements[id];
      if (!element) continue;
      for (const claim of this.claims.values()) {
        if (!claim.scope || !this.covers(claim, element, after)) continue;
        const set = this.changedByUser.get(claim.taskId) ?? new Set<string>();
        set.add(id);
        this.changedByUser.set(claim.taskId, set);
      }
    }
  }

  /** Which of these elements the user changed since the task last looked; reading them clears the note. */
  takeUserChanges(taskId: string, ids: string[]): Set<string> {
    const noted = this.changedByUser.get(taskId);
    const changed = new Set<string>();
    if (!noted) return changed;
    for (const id of ids) {
      if (noted.delete(id)) changed.add(id);
    }
    return changed;
  }

  /** A scope without these listed ids, or undefined when nothing would be left of it. */
  static withoutIds(scope: TaskScope, ids: string[]): TaskScope | undefined {
    const left = scope.ids?.filter((id) => !ids.includes(id));
    const { ids: _dropped, ...rest } = scope;
    if (left?.length) return { ...rest, ids: left };
    return Object.keys(rest).length > 0 ? rest : undefined;
  }
}
