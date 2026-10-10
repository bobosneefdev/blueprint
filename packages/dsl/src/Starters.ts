// Starter plugin pack, bundled into the bot binary (JSON imports are inlined by bun build).
import afk from "../starter/afk-alert.json";
import cargo from "../starter/cargo-alert.json";
import death from "../starter/death-notice.json";
import heli from "../starter/heli-alert.json";
import lights from "../starter/night-lights.json";
import online from "../starter/online-notice.json";
import pop from "../starter/pop.json";
import alarm from "../starter/raid-alarm.json";
import team from "../starter/team-status.json";
import wipe from "../starter/wipe-notice.json";
import { validate } from "./Validate.ts";

/** Every starter is validated at load; a broken one fails loudly instead of shipping. */
export const all = () =>
  [afk, cargo, death, heli, lights, online, pop, alarm, team, wipe].map((json) => {
    const r = validate(json);

    if (!r.ok) throw new Error(`starter invalid: ${JSON.stringify(r.problems)}`);

    return r.plugin;
  });
