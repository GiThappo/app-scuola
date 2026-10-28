import grades from "../fixtures/grades.json";
import subjects from "../fixtures/subjects.json";
import periods from "../fixtures/periods.json";
import agenda from "../fixtures/agenda.json";
import lessons from "../fixtures/lessons.json";
import calendar from "../fixtures/calendar.json";
import didactics from "../fixtures/didactics.json";
import whoami from "../fixtures/whoami.json";
import avg from "../fixtures/avg.json";


type Opzioni = { login?: unknown; stato?: (url: string) => number; agenda?: unknown[]; calendario?: unknown[]; corpi?: [string, unknown][] };
export function finto(o: Opzioni = {}) {
  const richieste: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    richieste.push({ url, init });
    const stato = o.stato?.(url) ?? 200;
    if (stato !== 200) return new Response("<H1>Access Denied</H1>", { status: stato });
    if (url.includes("login.php")) return new Response("<html>", { headers: { "set-cookie": "PHPSESSID=primo; path=/" } });
    if (url.includes("AuthApi4")) return Response.json(o.login ?? { data: { auth: { loggedIn: true, errors: [] } } }, { headers: { "set-cookie": "PHPSESSID=secondo; path=/" } });
    const corpo: [string, unknown][] = [["misc/whoami", whoami], ["/grades", grades], ["/subjects", subjects], ["/periods", periods],
      ["/agendav2/", o.agenda ? { agenda: o.agenda } : agenda], ["/lessons/", lessons], ["/calendar/", o.calendario ? { calendar: o.calendario } : calendar], ["/didactics", didactics], ["/avg", avg]];
    const trovato = [...(o.corpi ?? []), ...corpo].find(([k]) => url.includes(k));
    return trovato ? Response.json(trovato[1]) : new Response("?", { status: 404 });
  }) as typeof fetch;
  return { fn, richieste };
}

