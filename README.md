# App Scuola

Web app per il telefono che prende voti, agenda e lezioni da **Classeviva** e organizza lo studio da sola.

- **Agenda**: compiti, verifiche e interrogazioni dei prossimi 30 giorni, ognuno alla data in cui va consegnato (quella della voce sul registro, o quella scritta nel testo). Le verifiche che i prof non scrivono sul registro le aggiungi tu con **＋ Verifica**.
- **Studio**: piano di studio automatico intorno ai tuoi impegni. I blocchi si possono spostare, segnare come fatti o eliminare.
- **Materie**: voti, medie, diario delle lezioni e il tuo materiale di studio (schede, PDF, appunti).
- **Recap**: il resoconto di ogni giorno scritto dal tutor, con quelli dei giorni prima.
- **Google Calendar** (facoltativo): il piano finisce nel tuo calendario e i tuoi impegni entrano nel piano.

Questo repo è un **modello**: non contiene l'app di nessuno. Segui le istruzioni e crei la tua, nel tuo account, con i tuoi dati.

Gira gratis su [Cloudflare Workers](https://workers.cloudflare.com/) (piano gratuito, senza carta) ed è protetta da una password. È pensata per **una persona**: chi la vuole se la installa nel suo account.

Fa parte di [tutor-scolastico](https://github.com/GiThappo/tutor-scolastico), le skill di Claude Code per lo stesso scopo. L'app però funziona anche senza Claude.

## Cosa serve

- Un account gratuito su [Cloudflare](https://dash.cloudflare.com/sign-up).
- [Node.js](https://nodejs.org/) 20 o più recente e [Git](https://git-scm.com/).
- Un terminale **bash**: su Mac e Linux c'è già, su Windows usa Git Bash (arriva con Git) o WSL.
- Nome utente e password di **Classeviva**.
- Per il calendario: un account Google.

## Installazione

### 1. Scarica e installa

```bash
git clone https://github.com/GiThappo/app-scuola.git
cd app-scuola
npm install
npx wrangler login        # si apre il browser: accedi a Cloudflare e autorizza
```

La prima volta che pubblichi qualcosa, Cloudflare ti fa scegliere un sottodominio (es. `mionome.workers.dev`). L'app sarà su `https://app-scuola.<sottodominio>.workers.dev`.

### 2. Crea il database

```bash
npx wrangler d1 create app-scuola
```

Il comando stampa un `database_id`. **Mettilo in `wrangler.toml`** al posto di `METTI-QUI-IL-TUO-DATABASE-ID`. Poi crea le tabelle:

```bash
npx wrangler d1 migrations apply app-scuola --remote
```

### 3. Pubblica l'app

```bash
npx wrangler deploy
```

### 4. Nome utente e password

Servono tre segreti. Restano cifrati su Cloudflare e non finiscono mai nel codice.

```bash
npx wrangler secret put CLASSEVIVA_UTENTE      # ti chiede il nome utente di Classeviva
npx wrangler secret put CLASSEVIVA_PASSWORD    # ti chiede la password di Classeviva
```

Poi scegli la **password dell'app**, quella che metterai sul telefono per entrare. Su Cloudflare non va la password ma una sua impronta (hash):

```bash
read -rs PASSWORD     # scrivi la password dell'app (non si vede) e premi Invio
printf '%s' "$PASSWORD" | node scripts/hash-password.mjs | npx wrangler secret put APP_PASSWORD_HASH
unset PASSWORD
```

### 5. Il tuo orario

L'app usa l'orario per capire quando scadono i compiti e quando c'è ogni materia. Copia l'esempio, cambialo e caricalo:

```bash
cp test/fixtures/orario.md orario.md
# apri orario.md e metti il tuo orario
scripts/carica-orario.sh orario.md
```

Il formato:
- **una tabella** con una riga per giorno, una colonna per ora, l'ora di uscita e se la giornata è pesante o leggera;
- sotto, le **regole** per pianificare in parole tue (es. "il mercoledì recupero le materie indietro");
- una sezione **`## Materie che non usano il registro`** con le materie i cui prof non scrivono i compiti: l'app ti ricorda di chiederli il giorno prima.

Se cambi orario, modifica il file e rilancia `scripts/carica-orario.sh orario.md`.

Fatto: apri l'indirizzo dal telefono, metti la password e aggiungi la pagina alla schermata Home.

### 6. Google Calendar (facoltativo)

Uno script nel tuo account Google, ogni 5 minuti, manda all'app gli **orari** dei tuoi impegni (non i titoli) e scrive nel calendario i blocchi di studio (`[Tutor] ...`). Tocca solo gli eventi che crea lui.

1. Crea un token e dallo all'app:
   ```bash
   TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
   printf '%s' "$TOKEN" | npx wrangler secret put CALENDARIO_TOKEN
   echo "$TOKEN"      # ti serve al punto 4, poi chiudi il terminale
   ```
2. Vai su [script.google.com](https://script.google.com/) → **Nuovo progetto**. Incolla il contenuto di `scripts/google-calendar/Codice.gs` al posto di quello che c'è.
3. **Impostazioni progetto** (ingranaggio): spunta "Mostra il file manifest appsscript.json". Torna all'editor e sostituisci `appsscript.json` con quello di `scripts/google-calendar/appsscript.json`.
4. Sempre in **Impostazioni progetto → Proprietà script** aggiungi:
   - `APP_URL` = `https://app-scuola.<sottodominio>.workers.dev`
   - `TOKEN` = il token del punto 1
5. Nell'editor scegli la funzione **`installa`** e premi **Esegui**. Google ti chiede i permessi: concedili (è il tuo script, nel tuo account). Da qui in poi gira da solo.

Nella scheda Studio dell'app vedi quando c'è stata l'ultima sincronizzazione.

### 7. Materiale e recap dal PC (facoltativo)

Schede, PDF e recap del giorno li scrive sul PC il [tutor](https://github.com/GiThappo/tutor-scolastico) (o li metti tu) in una cartella così:

```
~/Scuola/
  app.env                                 APP_URL=https://app-scuola.<sottodominio>.workers.dev
                                          APP_DIR=<cartella di questo repo>
  materiale/<Materia>/schede/*.md         schede di studio (si leggono dentro l'app)
  materiale/<Materia>/fonti/*.pdf         PDF e altre fonti (si aprono nel browser del telefono)
  materiale/<Materia>/appunti/*           appunti (txt, md, foto)
  report/AAAA-MM-GG.txt                   recap del giorno
```

Per caricarli nell'app:

```bash
node scripts/carica-materiale.mjs            # usa ~/Scuola; --prova per vedere cosa farebbe
```

Carica solo i file nuovi o cambiati e toglie dall'app quelli che hai cancellato dal PC. Ti chiede la password dell'app, a meno che non sia in `APP_PASSWORD` o nel file `.password-app` di questo repo (fuori da git). Le skill del tutor lo lanciano da sole se `app.env` ha `APP_DIR`.

## Come si aggiorna

- **Quando apri l'app** scarica il registro, se l'ultimo aggiornamento ha più di un'ora. C'è anche il pulsante **Aggiorna**.
- **Ogni ora, di giorno** (dalle 7 alle 21 con l'ora legale, dalle 6 alle 20 con quella solare), un cron di Cloudflare prova ad aggiornare anche se non la apri. Classeviva rifiuta alcune zone dei server Cloudflare, quindi il cron passa da un Durable Object in Europa occidentale. Se dovesse fallire comunque, resta l'aggiornamento all'apertura.

## Sviluppo

```bash
npm test                          # test (Vitest con il runtime dei Workers)
npx wrangler d1 migrations apply app-scuola --local
npx wrangler dev                  # app in locale su http://localhost:8787
```

In locale servono i segreti in un file `.dev.vars` (non va su Git):

```
CLASSEVIVA_UTENTE=...
CLASSEVIVA_PASSWORD=...
APP_PASSWORD_HASH=...
```

Il codice:
- `src/classeviva/`: client delle API di Classeviva
- `src/registro/`: aggiornamento del database, agenda, scadenze, orario, voti
- `src/studio/`: piano di studio e sincronizzazione con Google Calendar
- `public/`: l'interfaccia (HTML, CSS e JavaScript senza framework)

I dati di prova in `test/fixtures/` sono risposte vere di Classeviva **anonimizzate**.

## Sicurezza

- La password dell'app è salvata solo come hash PBKDF2. Dopo troppi tentativi sbagliati il login si blocca per un po'.
- Le credenziali di Classeviva sono segreti di Cloudflare: non stanno nel codice né nel database.
- Il token del calendario serve solo allo script di Google e si confronta in tempo costante.
