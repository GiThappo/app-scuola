// Pubblica l'app e, se non riesce, riprova: alla prima installazione il token creato da Cloudflare può non essere ancora attivo.
import { spawnSync } from "node:child_process";

const comando = process.env.COMANDO_PUBBLICA ?? "npx wrangler deploy";
const tentativi = 6;
const attesaMs = Number(process.env.ATTESA_PUBBLICA_MS ?? 30_000);

for (let i = 1; i <= tentativi; i++) {
  if (spawnSync(comando, { shell: true, stdio: "inherit" }).status === 0) process.exit(0);
  if (i < tentativi) {
    console.error(`Pubblicazione non riuscita (tentativo ${i} di ${tentativi}). Riprovo tra ${attesaMs / 1000} secondi.`);
    await new Promise((r) => setTimeout(r, attesaMs));
  }
}
console.error("Pubblicazione non riuscita dopo tutti i tentativi.");
process.exit(1);
