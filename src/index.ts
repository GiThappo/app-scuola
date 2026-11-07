import { creaApp } from "./api";
import type { Env } from "./registro/aggiorna";

export { Aggiornatore } from "./registro/aggiornatore";

const app = creaApp();

// Classeviva non si raggiunge da tutti i punti della rete di Cloudflare: si prova il successivo solo se il sito non ha risposto
const PUNTI_DI_RETE = [
  { nome: "registro", luogo: "weur" },
  { nome: "registro-eeur", luogo: "eeur" },
] as const;

export default {
  fetch: app.fetch,
  async scheduled(evento: ScheduledController, env: Env, ctx: ExecutionContext) {
    const quando = new Date(evento.scheduledTime).toISOString();
    ctx.waitUntil((async () => {
      for (const { nome, luogo } of PUNTI_DI_RETE) {
        const r = await env.AGGIORNATORE.get(env.AGGIORNATORE.idFromName(nome), { locationHint: luogo }).aggiorna(quando);
        console.log(JSON.stringify({ cron: r, luogo }));
        if (!r.riprova) return;
      }
    })());
  },
} satisfies ExportedHandler<Env>;
