import { Hono } from "hono";
import { richiediLogin, rotteAuth } from "./auth";
import { aggiorna, type Env } from "./registro/aggiorna";
import { aggiungiGiorni, giornoIso, inizioAnnoScolastico, oggiRoma } from "./registro/date";
import { haMateria, parseOrario, stessaMateria } from "./registro/orario";
import { rotteStudio } from "./studio/api";
import { ripianifica } from "./studio/ripianifica";
import { intestazioniSicurezza } from "./sicurezza";

type Opzioni = { now?: () => Date; fetchFn?: typeof fetch };

type RigaAgenda = { id: number; data: string; materie: string; testo: string; tipo: string; scadenza: string | null; dedotta: number; visto_il: string };
type RigaVoto = { id: number; materia: string; data: string; voto: string; valore: number | null; peso: number; tipo: string; periodo: number; nota: string; visto_il: string };

const GIORNO_MS = 24 * 3600 * 1000;
const PAUSA_AGGIORNA_MS = 60 * 1000;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function mediaRighe(voti: RigaVoto[]): number | null {
  const validi = voti.filter((v) => v.valore != null);
  const pesi = validi.reduce((s, v) => s + v.peso, 0);
  return pesi ? Math.round((validi.reduce((s, v) => s + v.valore! * v.peso, 0) / pesi) * 100) / 100 : null;
}

export function creaApp({ now = () => new Date(), fetchFn }: Opzioni = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", intestazioniSicurezza);
  app.route("/", rotteAuth);
  app.use("/api/*", richiediLogin);

  const impostazioni = async (db: D1Database) => {
    const righe = (await db.prepare("SELECT chiave, valore FROM impostazioni").all<{ chiave: string; valore: string | null }>()).results;
    return Object.fromEntries(righe.map((r) => [r.chiave, r.valore])) as Record<string, string | null>;
  };
  const recente = (iso: string) => now().getTime() - new Date(iso).getTime() < GIORNO_MS;
  const voceApi = (r: RigaAgenda) => ({
    id: r.id, materie: JSON.parse(r.materie) as string[], testo: r.testo, tipo: r.tipo,
    scadenza: r.scadenza, dedotta: !!r.dedotta, nuova: recente(r.visto_il), tua: r.id < 0,
  });

  app.get("/api/stato", async (c) => {
    const imp = await impostazioni(c.env.DB);
    return c.json({ oggi: oggiRoma(now()), ultimo_ok: imp.ultimo_ok ?? null, ultimo_tentativo: imp.ultimo_tentativo ?? null, ultimo_errore: imp.ultimo_errore ?? null });
  });

  app.post("/api/aggiorna", async (c) => {
    const { ultimo_tentativo } = await impostazioni(c.env.DB);
    if (ultimo_tentativo && now().getTime() - new Date(ultimo_tentativo).getTime() < PAUSA_AGGIORNA_MS) {
      return c.json({ errore: "Aggiornamento appena fatto" }, 429);
    }
    const r = await aggiorna(c.env, now(), fetchFn);
    return r.inCorso ? c.json({ errore: r.errore }, 429) : c.json(r);
  });

  app.get("/api/agenda", async (c) => {
    const db = c.env.DB;
    const oggi = oggiRoma(now());
    const domani = aggiungiGiorni(oggi, 1);
    const voci = (await db.prepare("SELECT * FROM agenda ORDER BY scadenza, id").all<RigaAgenda>()).results;
    const voti = (await db.prepare("SELECT materia, data FROM voti").all<{ materia: string; data: string }>()).results;

    const giorni = new Map<string, ReturnType<typeof voceApi>[]>();
    for (const v of voci) {
      if (v.scadenza && v.scadenza >= domani && v.scadenza <= aggiungiGiorni(oggi, 30)) {
        giorni.set(v.scadenza, [...(giorni.get(v.scadenza) ?? []), voceApi(v)]);
      }
    }
    // Resta finché non ha una data (correzione a mano: Piano 2), ma solo per l'anno scolastico in corso
    const daControllare = voci.filter((v) => !v.scadenza && v.data >= inizioAnnoScolastico(oggi)).map(voceApi);
    const senzaVoto = voci
      .filter((v) => v.tipo !== "COMPITO" && v.scadenza && v.scadenza <= oggi && v.scadenza >= aggiungiGiorni(oggi, -30))
      .filter((v) => {
        const materie: string[] = JSON.parse(v.materie);
        return !voti.some((x) => x.data >= v.scadenza! && materie.some((m) => stessaMateria(m, x.materia)));
      })
      .map((v) => ({ materia: (JSON.parse(v.materie) as string[]).join(" / "), data: v.scadenza!, testo: v.testo }));

    const { orario_md } = await impostazioni(db);
    const orario = parseOrario(orario_md ?? "");
    const giornoDomani = await db.prepare("SELECT scuola FROM giorni WHERE data = ?").bind(domani).first<{ scuola: number }>();
    const promemoria = giornoDomani?.scuola === 0 ? [] : orario.senzaRegistro.filter((m) => haMateria(orario, giornoIso(domani), m));
    const materie = (await db.prepare("SELECT DISTINCT materia FROM voti UNION SELECT DISTINCT materia FROM lezioni ORDER BY materia").all<{ materia: string }>()).results;

    return c.json({
      giorni: [...giorni].sort(([a], [b]) => a.localeCompare(b)).map(([data, voci]) => ({ data, voci })),
      da_controllare: daControllare,
      senza_voto: senzaVoto,
      promemoria,
      materie: materie.map((m) => m.materia),
    });
  });

  // Verifiche che non sono sul registro: id negativo, così l'aggiornamento da Classeviva non le tocca
  app.post("/api/agenda", async (c) => {
    const db = c.env.DB;
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const materia = typeof b.materia === "string" && b.materia.trim().length <= 60 ? b.materia.trim() : "";
    const testo = typeof b.testo === "string" && b.testo.length <= 1000 ? b.testo.trim() : null;
    const oggi = oggiRoma(now());
    if (!materia || testo == null || !DATA.test(String(b.data)) || String(b.data) < oggi) {
      return c.json({ errore: "Servono materia e giorno (da oggi in poi)" }, 400);
    }
    const r = await db.prepare(
      `INSERT INTO agenda (id, data, materie, testo, docente, tipo, scadenza, dedotta, visto_il)
       VALUES (MIN(-1, (SELECT IFNULL(MIN(id), 0) FROM agenda) - 1), ?, ?, ?, 'aggiunta a mano', 'VERIFICA', ?, 0, ?) RETURNING id`,
    ).bind(oggi, JSON.stringify([materia]), testo, b.data, now().toISOString()).first<{ id: number }>();
    await ripianifica(db, now());
    return c.json({ id: r!.id }, 201);
  });

  app.delete("/api/agenda/:id", async (c) => {
    const db = c.env.DB;
    const r = await db.prepare("DELETE FROM agenda WHERE id = ? AND id < 0 RETURNING id").bind(Number(c.req.param("id"))).first();
    if (!r) return c.json({ errore: "Voce non trovata" }, 404);
    await ripianifica(db, now());
    return c.json({ ok: true });
  });

  rotteStudio(app, now);

  app.get("/api/materie", async (c) => {
    const db = c.env.DB;
    const voti = (await db.prepare("SELECT * FROM voti").all<RigaVoto>()).results;
    const conLezioni = (await db.prepare("SELECT DISTINCT materia FROM lezioni").all<{ materia: string }>()).results.map((r) => r.materia);
    const nomi = [...new Set([...voti.map((v) => v.materia), ...conLezioni])].sort((a, b) => a.localeCompare(b));
    return c.json(nomi.map((nome) => {
      const suoi = voti.filter((v) => v.materia === nome);
      const media = mediaRighe(suoi);
      return { nome, media, n_voti: suoi.length, sotto_sei: media != null && media < 6 };
    }));
  });

  app.get("/api/materie/:nome", async (c) => {
    const db = c.env.DB;
    const nome = c.req.param("nome");
    const oggi = oggiRoma(now());
    const voti = (await db.prepare("SELECT * FROM voti WHERE materia = ? ORDER BY data DESC").bind(nome).all<RigaVoto>()).results;
    const lezioni = (await db.prepare("SELECT data, ora, argomento FROM lezioni WHERE materia = ? ORDER BY data DESC, ora").bind(nome)
      .all<{ data: string; ora: number; argomento: string }>()).results;
    const inArrivo = (await db.prepare("SELECT * FROM agenda WHERE scadenza >= ? ORDER BY scadenza").bind(oggi).all<RigaAgenda>()).results
      .filter((v) => (JSON.parse(v.materie) as string[]).some((m) => stessaMateria(m, nome)));
    if (!voti.length && !lezioni.length && !inArrivo.length) return c.json({ errore: "Materia non trovata" }, 404);

    const diario = new Map<string, { data: string; ore: number[]; argomento: string }>();
    for (const l of lezioni) {
      const k = `${l.data}|${l.argomento}`;
      const d = diario.get(k) ?? { data: l.data, ore: [], argomento: l.argomento };
      d.ore.push(l.ora);
      diario.set(k, d);
    }
    return c.json({
      nome,
      media: mediaRighe(voti),
      voti: voti.map((v) => ({ data: v.data, voto: v.voto, valore: v.valore, tipo: v.tipo, periodo: v.periodo, nota: v.nota, nuovo: recente(v.visto_il) })),
      in_arrivo: inArrivo.map(voceApi),
      lezioni: [...diario.values()],
    });
  });

  return app;
}
