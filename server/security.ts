import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCb);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return salt + ":" + hash.toString("hex");
}
export async function checkPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function key() {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw || !/^[a-f0-9]{64}$/i.test(raw))
    throw new Error("DATA_ENCRYPTION_KEY must contain 64 hex characters");
  return Buffer.from(raw, "hex");
}
export function encrypt(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  return [
    iv.toString("hex"),
    Buffer.concat([c.update(text, "utf8"), c.final()]).toString("hex"),
    c.getAuthTag().toString("hex"),
  ].join(".");
}
export function decrypt(text: string) {
  const [iv, data, tag] = text.split(".");
  const c = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "hex"));
  c.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    c.update(Buffer.from(data, "hex")),
    c.final(),
  ]).toString("utf8");
}
export function verifyTelegram(initData: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token)
    throw Object.assign(new Error("Вход через Telegram ещё не настроен"), {
      status: 503,
    });
  const p = new URLSearchParams(initData);
  const hash = p.get("hash") || "";
  p.delete("hash");
  const lines = [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secret).update(lines).digest("hex");
  const time = Number(p.get("auth_date"));
  if (
    !/^[a-f0-9]{64}$/.test(hash) ||
    !timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expected, "hex")) ||
    !Number.isFinite(time) ||
    time > Date.now() / 1000 + 30 ||
    time < Date.now() / 1000 - 300
  )
    throw Object.assign(new Error("Недействительная авторизация Telegram"), {
      status: 401,
    });
  const u = JSON.parse(p.get("user") || "{}");
  if (!Number.isSafeInteger(u.id) || u.id <= 0)
    throw Object.assign(new Error("Нет пользователя Telegram"), {
      status: 401,
    });
  return u;
}
