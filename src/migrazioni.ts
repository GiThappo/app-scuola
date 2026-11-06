import m0001 from "../migrations/0001_init.sql";
import m0002 from "../migrations/0002_sessioni.sql";
import m0003 from "../migrations/0003_studio.sql";
import m0004 from "../migrations/0004_origine.sql";
import m0005 from "../migrations/0005_materiale.sql";
import m0006 from "../migrations/0006_medie_e_fatti.sql";

export type Migrazione = { nome: string; sql: string };

/** Nuova migrazione: aggiungi il file in migrations/ e anche qui (un test controlla che ci siano tutte). */
export const MIGRAZIONI: Migrazione[] = [
  { nome: "0001_init.sql", sql: m0001 },
  { nome: "0002_sessioni.sql", sql: m0002 },
  { nome: "0003_studio.sql", sql: m0003 },
  { nome: "0004_origine.sql", sql: m0004 },
  { nome: "0005_materiale.sql", sql: m0005 },
  { nome: "0006_medie_e_fatti.sql", sql: m0006 },
];

const comandi = (sql: string) => sql.replace(/^\s*--.*$/gm, "").split(/;\s*(?:\n|$)/).map((c) => c.trim()).filter(Boolean);

/**
 * Crea le tabelle che mancano, al primo avvio: così l'installazione con il pulsante non dipende dal token della build.
 * Usa la stessa tabella di `wrangler d1 migrations`, quindi le due strade non si pestano i piedi.
 */
export async function applicaMigrazioni(db: D1Database, lista: Migrazione[] = MIGRAZIONI): Promise<void> {
  await db.prepare("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)").run();
  const fatte = async () => new Set((await db.prepare("SELECT name FROM d1_migrations").all<{ name: string }>()).results.map((r) => r.name));
  const gia = await fatte();
  for (const { nome, sql } of lista) {
    if (gia.has(nome)) continue;
    try {
      // batch = una transazione: una migrazione si applica tutta o per niente
      await db.batch([...comandi(sql).map((c) => db.prepare(c)), db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(nome)]);
    } catch (e) {
      // Due richieste insieme al primo avvio: se l'ha applicata l'altra va bene, altrimenti è un errore vero
      if (!(await fatte()).has(nome)) throw e;
    }
  }
}
