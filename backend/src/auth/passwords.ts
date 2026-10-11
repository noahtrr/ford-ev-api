// Passwörter werden nie im Klartext gespeichert, nur als Hash.
// Neue Passwörter (in der App geändert) speichern wir mit scrypt, das in Node.js eingebaut ist.
// Das Passwort aus der Server-Einrichtung hat Caddy mit bcrypt erzeugt, das prüfen wir mit bcryptjs.
import bcrypt from "bcryptjs";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

/** Erzeugt einen Hash im Format scrypt$N$r$p$salt$hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

/** Prüft ein Passwort gegen einen scrypt- oder bcrypt-Hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith("$2")) return bcrypt.compare(password, stored);
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}
