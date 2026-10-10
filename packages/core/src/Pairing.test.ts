import { expect, test } from "bun:test";
import { parseNotification } from "./Pairing.ts";

// Shape of real Rust+ pair notifications (rustplus.js docs / FCM appData).
const data = (body: Readonly<Record<string, string>>) => [
  { key: "title", value: "Rustoria" },
  { key: "body", value: JSON.stringify(body) },
];

test("server pair notification", () => {
  expect(
    parseNotification(
      data({
        type: "server",
        id: "abc",
        name: "Rustoria.co - US Main",
        ip: "1.2.3.4",
        port: "28083",
        playerId: "76561198118274372",
        playerToken: "-123456",
      }),
    ),
  ).toEqual({
    type: "server",
    id: "abc",
    name: "Rustoria.co - US Main",
    ip: "1.2.3.4",
    port: 28083,
    playerId: "76561198118274372",
    playerToken: -123456,
  });
});

test("entity pair notification and junk", () => {
  expect(
    parseNotification(
      data({
        type: "entity",
        id: "abc",
        ip: "1.2.3.4",
        port: "28083",
        entityId: "777",
        entityType: "2",
        entityName: "Smart Alarm",
      }),
    )?.type,
  ).toBe("entity");
  expect(parseNotification([{ key: "body", value: "not json" }])).toBeUndefined();
  expect(parseNotification([])).toBeUndefined();
});
