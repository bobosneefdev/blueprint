// Pure plugin execution: (plugin, world, event, state, args) -> effects + next state.
// The runtime, `bot validate` fixture tests, and `bot dry-run` replay all go through `run`.
import { Data } from "effect";
import * as Cel from "./Cel.ts";
import { Action, type Plugin, type Value, type ValueMap } from "./Plugin.ts";
import type { World } from "./World.ts";

export type Effect_ = Data.TaggedEnum<{
  TeamChat: { readonly text: string };
  SmartSwitch: { readonly binding: string; readonly on: boolean };
  SetState: { readonly key: string; readonly value: Value };
  Notify: { readonly text: string; readonly channel: "toast" | "phone" | "both" };
}>;

export const Effect_ = Data.taggedEnum<Effect_>();

export interface RunInput {
  readonly plugin: Plugin;
  readonly world: World;
  readonly event: ValueMap;
  readonly state: ValueMap;
  readonly args: ValueMap;
}

export interface RunOutput {
  readonly effects: ReadonlyArray<Effect_>;
  readonly state: ValueMap;
}

export const MAX_EACH = 32;

export class EvalError extends Data.TaggedError("EvalError")<{
  readonly plugin: string;
  readonly at: string;
  readonly message: string;
}> {}

const resolve = (action: Action, scope: Cel.Scope) =>
  Action.match(action, {
    TeamChat: (a): Effect_ => Effect_.TeamChat({ text: Cel.render(a.text, scope) }),
    Notify: (a): Effect_ => Effect_.Notify({ text: Cel.render(a.text, scope), channel: a.channel }),
    SmartSwitch: (a): Effect_ =>
      Effect_.SmartSwitch({ binding: a.binding, on: Cel.evaluate(a.on, scope) === true }),
    SetState: (a): Effect_ => Effect_.SetState({ key: a.key, value: Cel.evaluate(a.value, scope) }),
  });

/**
 * Runs every step in order. SetState is applied immediately so later steps see it, which lets a
 * plugin "alert then remember" within one run.
 */
export const run = (input: RunInput): RunOutput => {
  const effects: Effect_[] = [];
  const state = { ...input.state };
  let at = "";

  try {
    for (const [i, step] of input.plugin.steps.entries()) {
      const scope: Cel.Scope = { world: input.world, event: input.event, state, args: input.args };

      at = `steps[${i}].when`;

      if (step.when !== undefined && Cel.evaluate(step.when, scope) !== true) continue;

      at = `steps[${i}].each`;

      // Teams are small (Rust caps teams well under this); a larger list means a runaway `each`.
      const items =
        step.each === undefined
          ? [undefined]
          : Cel.evaluateList(step.each, scope).slice(0, MAX_EACH);

      for (const it of items) {
        for (const [j, action] of step.actions.entries()) {
          at = `steps[${i}].actions[${j}]`;

          const effect = resolve(action, it === undefined ? scope : { ...scope, it });

          Effect_.$match(effect, {
            SetState: (e) => (state[e.key] = e.value),
            TeamChat: () => undefined,
            SmartSwitch: () => undefined,
            Notify: () => undefined,
          });
          effects.push(effect);
        }
      }
    }
  } catch (e) {
    throw new EvalError({
      plugin: input.plugin.name,
      at,
      message: e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e),
    });
  }

  return { effects, state };
};
