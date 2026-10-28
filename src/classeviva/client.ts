import { aggiungiGiorni } from "../registro/date";
import type { VotoCV } from "../registro/voti";

const BASE = "https://web.spaggiari.eu";
const PAGINA_LOGIN = `${BASE}/home/app/default/login.php?target=&mode=`;
const LOGIN = `${BASE}/auth-p7/app/default/AuthApi4.php?a=aLoginPwd`;
const REST = `${BASE}/rest/w1`;

// Come in Classeviva.py (variabili/variabili.py)
const INTESTAZIONI = {
  "Z-Dev-ApiKey": "Tg1NWEwNGIgIC0K",
  "User-Agent": "CVVS/std/4.2.3 Android/12",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  "Origin": BASE,
  "Referer": PAGINA_LOGIN,
};

export class ErroreClasseviva extends Error {
  constructor(message: string, public fase: "login" | "dati", public stato: number) {
    super(message);
    this.name = "ErroreClasseviva";
  }
}

export type DatiRegistro = {
  voti: VotoCV[];
  materie: any[];
  periodi: any[];
  agenda: any[];
  lezioni: any[];
  calendario: any[];
  didattica: any[];
  /** medie per materia calcolate da Classeviva; null se non sono arrivate */
  medie: { subjectAverages: Record<string, any> } | null;
};

const ymd = (d: string) => d.replaceAll("-", "");
const sessione = (r: Response) => r.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0];

/** Anno di inizio dell'anno scolastico in formato YY (ottobre 2026 → "26", marzo 2027 → "26"). */
function annoScolastico(oggi: string): string {
  const [anno, mese] = oggi.split("-").map(Number);
  return String((mese >= 9 ? anno : anno - 1) % 100).padStart(2, "0");
}

async function accedi(utente: string, password: string, fetchFn: typeof fetch): Promise<string> {
  const pagina = await fetchFn(PAGINA_LOGIN, { headers: INTESTAZIONI });
  if (!pagina.ok) throw new ErroreClasseviva(`Classeviva ha rifiutato la connessione (HTTP ${pagina.status})`, "login", pagina.status);
  let cookie = sessione(pagina) ?? "";
  const risposta = await fetchFn(LOGIN, {
    method: "POST",
    headers: { ...INTESTAZIONI, Cookie: cookie },
    body: new URLSearchParams({ cid: "", uid: utente, pwd: password, pin: "", target: "" }).toString(),
  });
  if (!risposta.ok) throw new ErroreClasseviva(`Login non riuscito (HTTP ${risposta.status})`, "login", risposta.status);
  const auth = ((await risposta.json().catch(() => ({}))) as any)?.data?.auth;
  if (!auth?.loggedIn) {
    throw new ErroreClasseviva(auth?.errors?.[0] ?? "Login non riuscito", "login", risposta.status);
  }
  return sessione(risposta) ?? cookie;
}

export async function scaricaRegistro(
  utente: string,
  password: string,
  oggi: string,
  fetchFn: typeof fetch = fetch,
): Promise<DatiRegistro> {
  const cookie = await accedi(utente, password, fetchFn);
  const get = async (percorso: string, chiave: string): Promise<any[]> => {
    const r = await fetchFn(`${REST}/${percorso}`, { headers: { ...INTESTAZIONI, Cookie: cookie } });
    const nome = percorso.split("/")[0];
    if (!r.ok) throw new ErroreClasseviva(`Classeviva non ha dato i dati (${nome}, HTTP ${r.status})`, "dati", r.status);
    // Senza la chiave attesa i dati non ci sono: meglio fallire che cancellare quelli salvati
    const corpo = (await r.json().catch(() => null)) as any;
    if (!Array.isArray(corpo?.[chiave])) throw new ErroreClasseviva(`Classeviva ha risposto senza i dati (${nome})`, "dati", r.status);
    return corpo[chiave];
  };

  const whoami = await fetchFn(`${REST}/misc/whoami`, { headers: { ...INTESTAZIONI, Cookie: cookie } });
  if (!whoami.ok) throw new ErroreClasseviva(`Classeviva non ha dato i dati (whoami, HTTP ${whoami.status})`, "dati", whoami.status);
  const id = ((await whoami.json()) as any).id;
  const s = `students/${id}`;
  const settembre = `${Number(annoScolastico(oggi)) + 2000}-09-01`;
  const inizioLezioni = aggiungiGiorni(oggi, -21) > settembre ? aggiungiGiorni(oggi, -21) : settembre;

  const [voti, materie, periodi, agenda, lezioni, calendario] = await Promise.all([
    get(`${s}/grades${annoScolastico(oggi)}`, "grades"),
    get(`${s}/subjects`, "subjects"),
    get(`${s}/periods`, "periods"),
    get(`${s}/agendav2/all/${ymd(aggiungiGiorni(oggi, -7))}/${ymd(aggiungiGiorni(oggi, 30))}`, "agenda"),
    get(`${s}/lessons/${ymd(inizioLezioni)}/${ymd(oggi)}`, "lessons"),
    get(`${s}/calendar/${ymd(oggi)}/${ymd(aggiungiGiorni(oggi, 21))}`, "calendar"),
  ]);
  // La sezione Didattica può essere disattivata dalla scuola: non è un errore
  const didattica = await get(`${s}/didactics`, "didacticts").catch(() => []);
  // Le medie servono solo da mostrare: senza, l'app le calcola da sé
  const medie = await fetchFn(`${REST}/${s}/avg`, { headers: { ...INTESTAZIONI, Cookie: cookie } })
    .then(async (r) => (r.ok ? ((await r.json()) as any) : null))
    .then((j) => (j?.subjectAverages && typeof j.subjectAverages === "object" ? j : null))
    .catch(() => null);
  return { voti, materie, periodi, agenda, lezioni, calendario, didattica, medie };
}
