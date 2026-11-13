import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Пароли пользователей админки: scrypt (встроен в Node, без внешних зависимостей).
// Формат хеша: scrypt$N$r$p$соль$хеш (base64url) — параметры хранятся рядом, их можно усилить позже.
// Без "server-only": модуль нужен и консольному скрипту scripts/admin-user.mts.

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

function derive(password: string, salt: Buffer, opts: ScryptOptions, keylen = KEYLEN) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, keylen, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string) {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await derive(password, Buffer.from(salt, "base64url"), { N: Number(n), r: Number(r), p: Number(p) }, expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Хеш-заглушка: проверка пароля несуществующего пользователя занимает то же время. */
export const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** Случайный пароль без похожих символов (0/O, 1/l/I): 16 знаков ≈ 90 бит. */
export function generatePassword(length = 16) {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export const MIN_PASSWORD_LENGTH = 10;

export const ROLE_LABELS = { ADMIN: "Администратор", MODERATOR: "Модератор", ORGANIZER: "Организатор" } as const;
