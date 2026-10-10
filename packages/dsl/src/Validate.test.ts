import { expect, test } from "bun:test";
import { Glob } from "bun";
import { Action, Expected, Trigger } from "./Plugin.ts";
import { validate } from "./Validate.ts";

const dir = new URL("../starter/", import.meta.url).pathname;

for (const file of new Glob("*.json").scanSync(dir)) {
  test(`starter/${file} validates and passes its fixtures`, async () => {
    const r = validate(await Bun.file(dir + file).json());

    expect(r.ok ? [] : r.problems).toEqual([]);
  });
}

const base = {
  name: "probe",
  description: "test",
  version: 1,
  trigger: Trigger.cases.Schedule.make({ everySeconds: 60 }),
  state: {},
  bindings: [],
  chatBudget: 1,
};

const chat = (text: string) => [{ actions: [Action.cases.TeamChat.make({ text })] }];

test("rejects a type error in a template", () => {
  const r = validate({
    ...base,
    steps: chat("{{now + 1}}"),
    tests: [{ name: "t", world: {}, expect: [] }],
  });

  expect(r.ok ? "" : r.problems[0]?.message).toContain("no such overload");
});

test("rejects unknown member fields at check time", () => {
  const r = validate({
    ...base,
    steps: [{ when: "team.exists(m, m.afk)", actions: chat("x")[0]!.actions }],
    tests: [{ name: "t", world: {}, expect: [] }],
  });

  expect(r.ok ? "" : r.problems[0]?.message).toContain("afk");
});

test("reports fixture mismatches with what actually happened", () => {
  const r = validate({
    ...base,
    steps: chat("hi {{string(size(team))}}"),
    tests: [
      {
        name: "t",
        world: { team: [{ steamId: "1" }] },
        expect: [Expected.cases.TeamChat.make({ contains: "bye" })],
      },
    ],
  });

  expect(r.ok ? "" : r.problems[0]?.message).toBe(
    'expected [TeamChat~"bye"] got [TeamChat("hi 1")]',
  );
});

test("fixture events must use the real payload, no renamed or extra fields", async () => {
  const cargo = await Bun.file(dir + "cargo-alert.json").json();

  const withEvent = (event: Record<string, string | number>) =>
    validate({ ...cargo, tests: [{ ...cargo.tests[0], event }] });

  const nested = withEvent({ marker: "x" });
  const extra = withEvent({ ...cargo.tests[0].event, extra: 1 });

  expect(nested.ok ? "" : nested.problems[0]?.path).toBe(
    'tests["announces cargo with grid"].event',
  );
  expect(extra.ok).toBe(false);
});
