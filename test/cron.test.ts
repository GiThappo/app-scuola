import { expect, test } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/registro/aggiorna";

test("il cron fa aggiornare il registro dal Durable Object in Europa", async () => {
  const chiamate: { nome?: string; opzioni?: unknown; quando?: string } = {};
  const namespace = {
    idFromName: (nome: string) => ((chiamate.nome = nome), { nome }),
    get: (_id: unknown, opzioni: unknown) => {
      chiamate.opzioni = opzioni;
      return { aggiorna: async (quando: string) => ((chiamate.quando = quando), { ok: true }) };
    },
  };
  const attese: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => attese.push(p), passThroughOnException() {} };
  const env = { AGGIORNATORE: namespace } as unknown as Env;

  await worker.scheduled!({ scheduledTime: Date.parse("2026-10-23T14:00:00Z"), cron: "0 5-19 * * *", noRetry() {} } as ScheduledController, env, ctx as unknown as ExecutionContext);
  await Promise.all(attese);

  expect(chiamate.nome).toBe("registro");
  expect(chiamate.opzioni).toEqual({ locationHint: "weur" });
  expect(chiamate.quando).toBe("2026-10-23T14:00:00.000Z");
});
