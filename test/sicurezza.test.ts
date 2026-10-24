import { expect, test } from "vitest";
import { env } from "cloudflare:workers";
import headersFile from "../public/_headers?raw";
import { creaApp } from "../src/api";
import { INTESTAZIONI } from "../src/sicurezza";

test("le risposte delle API hanno le intestazioni di sicurezza, anche gli errori", async () => {
  const r = await creaApp().fetch(new Request("https://app.test/api/agenda"), env as any);
  expect(r.status).toBe(401);
  expect(r.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  expect(r.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  expect(r.headers.get("X-Frame-Options")).toBe("DENY");
  expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(r.headers.get("Strict-Transport-Security")).toMatch(/max-age=\d{7,}/);
});

test("le pagine statiche (public/_headers) hanno le stesse intestazioni", () => {
  const righe = headersFile.split("\n").filter((r) => /^\s+\S+:/.test(r)).map((r) => r.trim());
  const dalFile = Object.fromEntries(righe.map((r) => [r.slice(0, r.indexOf(":")), r.slice(r.indexOf(":") + 1).trim()]));
  expect(dalFile).toEqual(INTESTAZIONI);
  expect(headersFile.split("\n")[0].trim()).toBe("/*");
});
