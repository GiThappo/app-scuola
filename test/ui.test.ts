import { expect, test } from "vitest";
import { etichettaGiorno, daQuanto } from "../public/formato.js";

test("etichettaGiorno", () => {
  expect(etichettaGiorno("2026-10-24", "2026-10-23")).toBe("Domani · sab 24");
  expect(etichettaGiorno("2026-10-23", "2026-10-23")).toBe("Oggi · ven 23");
  expect(etichettaGiorno("2026-10-26", "2026-10-23")).toBe("Lun 26");
  expect(etichettaGiorno("2026-11-02", "2026-10-23")).toBe("Lun 2 nov");
});

test("daQuanto", () => {
  const now = new Date("2026-10-23T14:00:00Z"); // 16:00 a Roma
  expect(daQuanto("2026-10-23T13:59:30Z", now)).toBe("adesso");
  expect(daQuanto("2026-10-23T13:55:00Z", now)).toBe("5 min fa");
  expect(daQuanto("2026-10-23T13:00:00Z", now)).toBe("1 ora fa");
  expect(daQuanto("2026-10-23T12:00:00Z", now)).toBe("2 ore fa");
  expect(daQuanto("2026-10-22T16:00:00Z", now)).toBe("ieri alle 18:00");
  expect(daQuanto("2026-10-20T07:30:00Z", now)).toBe("il 20/10 alle 09:30");
});
