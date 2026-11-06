import { Hono } from "hono";
import { richiediLogin, rotteAuth } from "./auth";
import { accedi, credenzialiRifiutate } from "./classeviva/client";
import { aggiorna, messaggioErrore, type Env } from "./registro/aggiorna";
import { leggiCredenziali, salvaCredenziali } from "./registro/credenziali";
import { aggiungiGiorni, giornoIso, inizioAnnoScolastico, oggiRoma } from "./registro/date";
import { haMateria, leggiOrarioInviato, parseOrario, propostaOrario, scriviOrario, stessaMateria } from "./registro/orario";
import { materialeDi, rotteMateriale } from "./materiale/api";
import { rotteStudio } from "./studio/api";
import { ripianifica } from "./studio/ripianifica";
import { intestazioniSicurezza } from "./sicurezza";

type Opzioni = { now?: () => Date; fetchFn?: typeof fetch };

type RigaAgenda = { id: number; data: string; materie: string; testo: string; tipo: string; scadenza: string | null; dedotta: number; visto_il: string; fatto: number };
type RigaVoto = { id: number; materia: string; data: string; voto: string; valore: number | null; peso: number; tipo: string; periodo: number; nota: string; visto_il: string; blu: number };
type RigaMedia = { materia: string; media: number | null; n_voti: number };

const GIORNO_MS = 24 * 3600 * 1000;
const PAUSA_AGGIORNA_MS = 60 * 1000;
const GIORNI_PER_PROPOSTA = 42;
const PAUSA_COLLEGA_MS = 30 * 1000;
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
    const classeviva = !(await leggiCredenziali(c.env)) ? "mancante" : imp.credenziali_rifiutate ? "rifiutata" : "ok";
    return c.json({
      oggi: oggiRoma(now()), ultimo_ok: imp.ultimo_ok ?? null, ultimo_tentativo: imp.ultimo_tentativo ?? null, ultimo_errore: imp.ultimo_errore ?? null,
      classeviva, ha_orario: Object.keys(parseOrario(imp.orario_md ?? "").giorni).length > 0,
    });
  });

  // Collega o corregge l'account: prova l'accesso e salva solo se Classeviva lo accetta
  app.post("/api/classeviva", async (c) => {
    const db = c.env.DB;
    const { utente, password } = (await c.req.json().catch(() => null) ?? {}) as { utente?: unknown; password?: unknown };
    const nome = typeof utente === "string" ? utente.trim() : "";
    if (!nome || nome.length > 100 || typeof password !== "string" || !password || password.length > 200) {
      return c.json({ errore: "Inserisci nome utente e password di Classeviva" }, 400);
    }
    const { classeviva_tentativo: tentativo } = await impostazioni(db);
    if (tentativo && now().getTime() - new Date(tentativo).getTime() < PAUSA_COLLEGA_MS) {
      return c.json({ errore: "Aspetta mezzo minuto e riprova: troppi tentativi possono bloccare l'account" }, 429);
    }
    const salva = (k: string, v: string | null) =>
      db.prepare("INSERT INTO impostazioni (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore").bind(k, v);
    await salva("classeviva_tentativo", now().toISOString()).run();
    try {
      await accedi(nome, password, fetchFn ?? fetch);
    } catch (e) {
      return c.json({ errore: messaggioErrore(e) }, credenzialiRifiutate(e) ? 400 : 502);
    }
    await salvaCredenziali(c.env, nome, password);
    await db.batch([salva("credenziali_rifiutate", null), salva("ultimo_errore", null)]);
    const r = await aggiorna(c.env, now(), fetchFn, { forza: true });
    return c.json({ ok: true, aggiornato: r.ok });
  });

  app.post("/api/aggiorna", async (c) => {
    const { ultimo_tentativo } = await impostazioni(c.env.DB);
    if (ultimo_tentativo && now().getTime() - new Date(ultimo_tentativo).getTime() < PAUSA_AGGIORNA_MS) {
      return c.json({ errore: "Aggiornamento appena fatto" }, 429);
    }
    const r = await aggiorna(c.env, now(), fetchFn, { forza: true });
    return r.inCorso ? c.json({ errore: r.errore }, 429) : c.json(r);
  });

  app.get("/api/agenda", async (c) => {
    const db = c.env.DB;
    const oggi = oggiRoma(now());
    const domani = aggiungiGiorni(oggi, 1);
    const voci = (await db.prepare("SELECT * FROM agenda ORDER BY scadenza, id").all<RigaAgenda>()).results;
    const voti = (await db.prepare("SELECT materia, data FROM voti").all<{ materia: string; data: string }>()).results;

    // Per domani va in cima: un compito è fatto se l'hai segnato tu o se hai finito tutti i suoi blocchi
    const blocchi = (await db.prepare("SELECT voce_id, fatto FROM blocchi WHERE eliminato = 0 AND voce_id IS NOT NULL").all<{ voce_id: number; fatto: number }>()).results;
    const fatto = (v: RigaAgenda) => {
      const suoi = blocchi.filter((b) => b.voce_id === v.id);
      return !!v.fatto || (suoi.length > 0 && suoi.every((b) => b.fatto));
    };
    const perDomani = voci.filter((v) => v.scadenza === domani).map((v) => ({ ...voceApi(v), fatto: fatto(v) }));

    const giorni = new Map<string, ReturnType<typeof voceApi>[]>();
    for (const v of voci) {
      if (v.scadenza && v.scadenza > domani && v.scadenza <= aggiungiGiorni(oggi, 30)) {
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
      per_domani: perDomani,
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

  // Fatto o da fare: vale per la voce e per i blocchi del piano fatti per lei
  app.patch("/api/agenda/:id", async (c) => {
    const db = c.env.DB;
    const id = Number(c.req.param("id"));
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    if (typeof b.fatto !== "boolean") return c.json({ errore: "Serve fatto: true o false" }, 400);
    const r = await db.prepare("UPDATE agenda SET fatto = ? WHERE id = ? RETURNING id").bind(b.fatto ? 1 : 0, id).first();
    if (!r) return c.json({ errore: "Voce non trovata" }, 404);
    await db.prepare("UPDATE blocchi SET fatto = ?, versione = versione + 1 WHERE voce_id = ? AND eliminato = 0 AND fatto != ?")
      .bind(b.fatto ? 1 : 0, id, b.fatto ? 1 : 0).run();
    await ripianifica(db, now());
    return c.json({ ok: true });
  });

  app.delete("/api/agenda/:id", async (c) => {
    const db = c.env.DB;
    const r = await db.prepare("DELETE FROM agenda WHERE id = ? AND id < 0 RETURNING id").bind(Number(c.req.param("id"))).first();
    if (!r) return c.json({ errore: "Voce non trovata" }, 404);
    await ripianifica(db, now());
    return c.json({ ok: true });
  });

  app.get("/api/orario", async (c) => {
    const { orario_md } = await impostazioni(c.env.DB);
    const orario = parseOrario(orario_md ?? "");
    const giorni = Object.keys(orario.giorni).map(Number).sort((a, b) => a - b).map((g) => ({
      giorno: g, ore: orario.giorni[g], uscita: orario.uscita[g] ?? null, giornata: orario.giornata[g] ?? null,
    }));
    const db = c.env.DB;
    const oggi = oggiRoma(now());
    const nomi = (await db.prepare("SELECT DISTINCT materia FROM voti UNION SELECT DISTINCT materia FROM lezioni").all<{ materia: string }>()).results.map((r) => r.materia);
    const proposta = giorni.length ? [] : propostaOrario((await db.prepare("SELECT data, ora, materia FROM lezioni WHERE data >= ?")
      .bind(aggiungiGiorni(oggi, -GIORNI_PER_PROPOSTA)).all<{ data: string; ora: number | null; materia: string }>()).results);
    const materie = [...new Set([...nomi, ...giorni.flatMap((g) => g.ore)])].sort((a, b) => a.localeCompare(b));
    return c.json({ oggi, giorni, note: orario.note, senza_registro: orario.senzaRegistro, materie, proposta });
  });

  app.put("/api/orario", async (c) => {
    const db = c.env.DB;
    const inviato = leggiOrarioInviato(await c.req.json().catch(() => null));
    if (typeof inviato === "string") return c.json({ errore: inviato }, 400);
    const { orario_md } = await impostazioni(db);
    await db.prepare("INSERT INTO impostazioni (chiave, valore) VALUES ('orario_md', ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore")
      .bind(scriviOrario(orario_md ?? "", inviato.giorni, inviato.senzaRegistro)).run();
    await ripianifica(db, now());
    return c.json({ ok: true });
  });

  rotteStudio(app, now);
  rotteMateriale(app, now);

  app.get("/api/materie", async (c) => {
    const db = c.env.DB;
    const voti = (await db.prepare("SELECT * FROM voti").all<RigaVoto>()).results;
    const conLezioni = (await db.prepare("SELECT DISTINCT materia FROM lezioni").all<{ materia: string }>()).results.map((r) => r.materia);
    const daRegistro = [...new Set([...voti.map((v) => v.materia), ...conLezioni])];
    // Cartelle del materiale senza voti né lezioni (nomi del PC, magari con maiuscole diverse da Classeviva)
    const conMateriale = (await db.prepare("SELECT DISTINCT materia FROM file").all<{ materia: string }>()).results.map((r) => r.materia)
      .filter((m, i, tutte) => !daRegistro.some((r) => stessaMateria(r, m)) && tutte.findIndex((x) => stessaMateria(x, m)) === i);
    const nomi = [...daRegistro, ...conMateriale].sort((a, b) => a.localeCompare(b));
    const medie = (await db.prepare("SELECT * FROM medie").all<RigaMedia>()).results;
    return c.json(nomi.map((nome) => {
      const suoi = voti.filter((v) => v.materia === nome);
      const cv = medie.find((m) => m.materia === nome);
      const media = cv ? cv.media : mediaRighe(suoi);
      return { nome, media, n_voti: suoi.length, sotto_sei: media != null && media < 6, media_classeviva: !!cv };
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
    const materiale = await materialeDi(db, nome);
    if (!voti.length && !lezioni.length && !inArrivo.length && !Object.values(materiale).some((l) => l.length)) {
      return c.json({ errore: "Materia non trovata" }, 404);
    }

    const diario = new Map<string, { data: string; ore: number[]; argomento: string }>();
    for (const l of lezioni) {
      const k = `${l.data}|${l.argomento}`;
      const d = diario.get(k) ?? { data: l.data, ore: [], argomento: l.argomento };
      d.ore.push(l.ora);
      diario.set(k, d);
    }
    // La media è quella di Classeviva (i voti blu non contano); se manca, calcolata qui con le stesse regole
    const cv = await db.prepare("SELECT * FROM medie WHERE materia = ?").bind(nome).first<RigaMedia>();
    return c.json({
      nome,
      media: cv ? cv.media : mediaRighe(voti),
      media_classeviva: !!cv,
      voti: voti.map((v) => ({
        data: v.data, voto: v.voto, valore: v.valore, tipo: v.tipo, periodo: v.periodo, nota: v.nota, nuovo: recente(v.visto_il), blu: !!v.blu,
      })),
      in_arrivo: inArrivo.map(voceApi),
      lezioni: [...diario.values()],
      materiale,
    });
  });

  return app;
}
