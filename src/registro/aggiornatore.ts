import { DurableObject } from "cloudflare:workers";
import { aggiorna, type Env } from "./aggiorna";

/**
 * Il cron gira a Singapore e Classeviva lo blocca (403); da un'esecuzione in Europa risponde.
 * Questo Durable Object nasce in Europa occidentale e fa lì l'aggiornamento.
 */
export class Aggiornatore extends DurableObject<Env> {
  async aggiorna(quando: string) {
    return aggiorna(this.env, new Date(quando));
  }
}
