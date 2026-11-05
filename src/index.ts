import { creaApp } from "./api";
import type { Env } from "./registro/aggiorna";

export { Aggiornatore } from "./registro/aggiornatore";

const app = creaApp();

export default {
  fetch: app.fetch,
  async scheduled(evento: ScheduledController, env: Env, ctx: ExecutionContext) {
    const aggiornatore = env.AGGIORNATORE.get(env.AGGIORNATORE.idFromName("registro"), { locationHint: "weur" });
    const quando = new Date(evento.scheduledTime).toISOString();
    ctx.waitUntil(aggiornatore.aggiorna(quando).then((r) => console.log(JSON.stringify({ cron: r }))));
  },
} satisfies ExportedHandler<Env>;
