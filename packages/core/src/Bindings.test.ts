import { expect, test } from "bun:test";
import { Validate } from "@blueprint/dsl";
import { addDevice, forServer, missing } from "./Bindings.ts";

const starter = async (name: string) => {
  const r = Validate.validate(
    await Bun.file(new URL(`../../dsl/starter/${name}.json`, import.meta.url)).json(),
  );

  if (!r.ok) throw new Error(name);

  return r.plugin;
};

test("devices bind by label, or to the only unbound slot of that kind", async () => {
  const lights = await starter("night-lights");
  const alarm = await starter("raid-alarm");
  const empty = { devices: [], bindings: {} };

  expect(missing(empty, alarm)).toEqual(["base-alarm"]);

  const a = addDevice(empty, { entityId: 7, kind: "alarm", label: "Smart Alarm" }, [lights, alarm]);
  const b = addDevice(a, { entityId: 9, kind: "switch", label: "Lights" }, [lights, alarm]);

  expect(b.bindings).toEqual({ "base-alarm": 7, lights: 9 });
  expect(missing(b, alarm)).toEqual([]);
  expect(forServer(b)).toEqual([
    { name: "base-alarm", entityId: 7, kind: "alarm" },
    { name: "lights", entityId: 9, kind: "switch" },
  ]);
});

test("ambiguous devices are recorded but not bound", async () => {
  const lights = await starter("night-lights");

  const twoSwitches = {
    ...lights,
    name: "other",
    bindings: [...lights.bindings, { name: "turret", kind: "switch" as const, description: "" }],
  };

  const r = addDevice(
    { devices: [], bindings: {} },
    { entityId: 3, kind: "switch", label: "Smart Switch" },
    [twoSwitches],
  );

  expect([r.devices.length, r.bindings]).toEqual([1, {}]);
});
