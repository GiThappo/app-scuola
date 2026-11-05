import { beforeAll, beforeEach, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { Hono } from "hono";
import { hashPassword, verificaPassword, rotteAuth, richiediLogin } from "../src/auth";
import type { Env } from "../src/registro/aggiorna";

const E = env as unknown as Env & { TEST_MIGRATIONS: any };
const PW = "una password lunga";
let ENV: Env;
const corpi: string[] = [];

const app = new Hono<{ Bindings: Env }>();
app.route("/", rotteAuth);
app.use("/api/*", richiediLogin);
app.get("/api/agenda", (c) => c.json({ giorni: [] }));

async function chiama(path: string, init: RequestInit = {}) {
  const r = await app.fetch(new Request(`https://app.test${path}`, init), ENV);
  corpi.push(await r.clone().text());
  return r;
}
const login = (password: string) =>
  chiama("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
const cookieDi = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];

beforeAll(async () => {
  ENV = { ...E, APP_PASSWORD_HASH: await hashPassword(PW) };
});
beforeEach(async () => {
  await applyD1Migrations(E.DB, E.TEST_MIGRATIONS);
  await E.DB.exec("DELETE FROM sessioni");
  await E.DB.exec("DELETE FROM tentativi_login");
});

test("hash e verifica", async () => {
  const h = await hashPassword(PW);
  expect(h).toMatch(/^pbkdf2\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  expect(await verificaPassword(PW, h)).toBe(true);
  expect(await verificaPassword("sbagliata", h)).toBe(false);
});

test("password giusta: cookie di sessione", async () => {
  const r = await login(PW);
  expect(r.status).toBe(200);
  const c = r.headers.get("set-cookie")!;
  for (const parte of ["sessione=", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=7776000"]) expect(c).toContain(parte);
});

test("password sbagliata", async () => {
  const r = await login("no");
  expect(r.status).toBe(401);
  expect(await r.json()).toEqual({ errore: "Password sbagliata" });
});

test("troppi tentativi", async () => {
  for (let i = 0; i < 5; i++) expect((await login("no")).status).toBe(401);
  const r = await login(PW);
  expect(r.status).toBe(429);
  expect(await r.json()).toEqual({ errore: "Troppi tentativi, riprova tra un minuto" });
});

test("API protette", async () => {
  expect((await chiama("/api/agenda")).status).toBe(401);
  expect(await (await chiama("/api/agenda")).json()).toEqual({ errore: "login richiesto" });
  const cookie = cookieDi(await login(PW));
  expect((await chiama("/api/agenda", { headers: { Cookie: cookie } })).status).toBe(200);
  await E.DB.prepare("INSERT INTO sessioni (token, scade) VALUES ('vecchia', '2020-01-01T00:00:00.000Z')").run();
  expect((await chiama("/api/agenda", { headers: { Cookie: "sessione=vecchia" } })).status).toBe(401);
});

test("logout", async () => {
  const cookie = cookieDi(await login(PW));
  expect((await chiama("/api/logout", { method: "POST", headers: { Cookie: cookie } })).status).toBe(200);
  expect((await chiama("/api/agenda", { headers: { Cookie: cookie } })).status).toBe(401);
});

test("nessuna risposta contiene segreti", () => {
  expect(corpi.length).toBeGreaterThan(5);
  for (const c of corpi) {
    expect(c).not.toContain(E.CLASSEVIVA_PASSWORD);
    expect(c).not.toContain(ENV.APP_PASSWORD_HASH);
  }
});
