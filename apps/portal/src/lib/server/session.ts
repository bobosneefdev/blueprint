// Stateless signed session cookie: "<sid64>.<expiry>.<hmac>". Secret is per install.
import { createHmac, timingSafeEqual } from "node:crypto";

const sign = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export const issue = (secret: string, sid64: string, ttlSeconds = 7 * 86400) => {
  const payload = `${sid64}.${Math.floor(Date.now() / 1000) + ttlSeconds}`;

  return `${payload}.${sign(secret, payload)}`;
};

export const read = (secret: string, cookie: string | undefined): string | undefined => {
  const [sid64, exp, mac] = (cookie ?? "").split(".");

  if (!sid64 || !exp || !mac) return undefined;

  const want = Buffer.from(sign(secret, `${sid64}.${exp}`));
  const got = Buffer.from(mac);

  if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;

  return Number(exp) > Date.now() / 1000 ? sid64 : undefined;
};
