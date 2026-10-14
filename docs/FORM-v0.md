# FORM v0 · Documento di contesto della demo attuale

Descrive FORM com'è oggi (commit 177e822, 14 ottobre 2026), ricostruito da un inventario del codice. È il riferimento "v0" citato da `docs/FORM-v1.md`. Le stringhe dell'interfaccia e i comandi sono tra virgolette in inglese, esattamente come appaiono o come vanno digitati. Le imprecisioni trovate nell'audit di Fase 0 sono corrette qui e annotate in `docs/AUDIT.md`.

---

## 1. Cos'è FORM

FORM è un progetto personale: il prototipo di un workspace adattivo. Descrivi a parole cosa stai cercando di fare e l'interfaccia cambia forma intorno a quell'intento. Non è una chat: l'agente non risponde con paragrafi. Traduce l'intento in modifiche dell'interfaccia e l'unica cosa che "dice" è una caption di una riga che descrive cosa è cambiato.

- Titolo del sito: "FORM — The Living Interface". Descrizione: "A living workspace that turns intention into interactive tools."
- Stato: work in progress, in sviluppo attivo. Solo alcune funzioni sono attive; per tutto il resto FORM dichiara apertamente che non lo supporta ancora.
- È online: repository GitHub, deploy automatico su Vercel a ogni push.
- Di default i comandi sono interpretati da un parser deterministico a regole, senza modelli AI e senza API key. Se sul server c'è una chiave Anthropic, FORM passa in automatico a Claude lato server. La top bar mostra quale motore è attivo ("Demo parser · no API key" oppure "Claude · server-side"); il piede della palette comandi dice però sempre "Demo parser · deterministic", anche con Claude attivo.
- Alla prima visita si apre un'intro sopra il workspace sfocato, che si può riaprire dal pulsante ⓘ in alto. Testi:
  - eyebrow "Personal project · Work in progress";
  - titolo "The living interface";
  - "FORM is a personal project: an experimental workspace where you describe what you need, and the interface reshapes itself around it.";
  - "It's a work in progress, still in active development. Only some features work for now; anything else, FORM will tell you it doesn't support yet.";
  - elenco "Works today": Project tracker · Views you add as you go: Tracker · Board · Timeline · Team · Focus · Brief · Team workload · Status brief for client or team · Breaking a task into steps · Moodboard;
  - pulsante "Enter FORM →".

## 2. Principi di progetto

1. **Intent → interface.** L'utente descrive l'obiettivo, non il comando tecnico. L'interfaccia si riconfigura: crea strumenti, cambia vista, densità, ordinamento e filtri, modifica i task, propone passi.
2. **L'agente è l'identità visiva.** È una massa d'inchiostro nero fluida (metaball). Gli strumenti che crea sono fatti della stessa materia: quando nasce un progetto, volumi d'inchiostro si staccano dall'agente e diventano le card.
3. **Un unico documento condiviso.** Tutte le viste rappresentano gli stessi dati. Ogni cambiamento è un'operazione presa da un vocabolario chiuso di 35 operazioni, applicata da un reducer senza effetti collaterali. Il reducer però non è deterministico: genera gli id con `Math.random` dentro sei operazioni. Le operazioni dell'agente sono validate con Zod; le modifiche dirette dalla UI no. Nessun codice viene generato a runtime: l'intelligenza può cambiare l'interfaccia solo attraverso queste operazioni.
4. **Onestà.** FORM non inventa niente:
   - durate, costi, date, capacità delle persone e immagini restano vuoti finché non li dà l'utente. Fanno eccezione oggi due default: "Add person" crea una persona con capacità 10 giorni, e "+ Duration" imposta 1 giorno;
   - le date sono derivate da data di inizio + stime e restano marcate come "sample" finché la data non è confermata;
   - scomposizioni in passi e riassegnazioni di lavoro sono proposte che l'utente accetta o scarta;
   - quello che non sa diventa una domanda;
   - quello che non sa fare viene rifiutato con un messaggio chiaro.
5. **Tutto è annullabile.** Undo e redo coprono sia i comandi all'agente sia le modifiche dirette, incluso il reset del workspace.
6. **Viste on demand.** Un progetto nasce con una sola vista, quella chiesta. Le altre si creano dopo: chiedendole all'agente, oppure cliccando i nodi che l'agente propone intorno a sé.

## 3. Art direction

**Riferimenti dichiarati**
- terreno chiaro con una griglia di micro-punti (PXDX);
- agente metaball nero;
- capsula di input scura in stile "Ask AI", con un satellite circolare staccato;
- righe a capsula e metriche circolari (Giza);
- card di vetro smerigliato.

**Primitive.** Solo cerchi e capsule, con raggi a token: card 28, pannello 36, pill 999.

**Palette**
- Quasi monocroma: carta #e9e9e6 (con varianti più chiara e più scura) e inchiostro #0a0a0a.
- Testo su carta e su inchiostro a gradini di opacità; linee sottili al 8–14% di inchiostro.
- Un solo colore funzionale, il rosso segnale #ff3b2f, usato solo come allarme: urgenze, sovraccarico, testi del brief da rivedere.
- Niente dark mode.

**Materiali**
1. `.glass`: bianco al 52%, blur 22px; usato per pannelli, corsie, barra delle tab, metriche, top bar, moodboard.
2. `.glass-hi`: off-white al 92%, blur 18px; usato per caption, popover, palette comandi, intro.
3. `.ink-material`: la capsula nera del composer, con luce radiale al centro, gradiente #161616→#090909 e un filo di luce sul bordo.
4. Il foglio di carta del brief: #fbfbf9, raggio 32.
5. Inchiostro piatto (`bg-ink`) per pulsanti primari, tab attiva, nodi suggeriti e card enfatizzate.

Le card cambiano tono (chiaro ↔ scuro) tramite variabili CSS locali, così gli stessi controlli funzionano su vetro e su inchiostro.

**Tipografia**
- Aeonik Pro per tutto: titoli, paragrafi, UI, numeri.
- Aeonik Mono Pro solo per gli eyebrow, le piccole etichette maiuscole.
- Font self-hosted in woff2.
- Scala a classi:
  - display-xl: clamp 44–76px (titolo Focus);
  - display-l: clamp 36–52px (titolo progetto, headline brief);
  - display-m: 26px;
  - title: 20px;
  - body-l: 17px;
  - body: 15px;
  - body-s: 13px (la maggior parte della UI);
  - data: 12px tabulare;
  - meta: 10px mono maiuscolo;
  - micro: 9.5px mono maiuscolo.
- Peso 400 quasi ovunque.

**Motion**
- Una sola curva per tutto ciò che si muove o si ridimensiona: `cubic-bezier(0.625, 0.05, 0, 1)` in 0.68s, chiamata "move".
- Molle "fluide, precise, leggermente organiche, mai rimbalzanti".
- Il testo non scorre: si "condensa" da una sfocatura, a parole, con un leggero zoom.
- Gli eyebrow mono si "decodificano" con glifi casuali `/·+—×:01`, a larghezza fissa.
- Le etichette dei pulsanti fanno ruotare le lettere all'hover (port di "Button 069" di Osmo Supply).
- Regola fissa: niente stiramenti o deformazioni durante le transizioni, niente scatti.

## 4. L'agente

### 4.1 Stati
L'agente è un'unica forma fluida con sei modalità:
- **Idle** (workspace vuoto): un anello vivo di volumi neri al centro dello schermo. Sotto: "Describe what you're trying to do." e "Click the form or press /".
- **Hover**: l'anello si stringe, le goccioline si fondono in un nucleo e dentro appare "• →". Premendo, la materia si raccoglie (anticipazione); al rilascio esplode nel composer.
- **Input**: i volumi si allineano dentro la capsula di comando e un volume si stacca diventando il pulsante di chiusura circolare (il "satellite").
- **Processing**: tre volumi che si separano e si ricongiungono attorno a un nucleo pulsante. È una pausa minima "onesta" di 340ms, senza finto ragionamento.
- **Emit**: alla creazione di un progetto, volumi d'inchiostro partono dall'agente e diventano le superfici dei task.
- **Compact**: con un progetto aperto, l'agente riposa in basso al centro come capsula "Ask FORM" con una mini-icona ad anello e il tasto "/".

### 4.2 Fisica
L'agente è simulato fisicamente, non animato con tween.
- 10 ellissi SVG (7 volumi dell'anello, 2 goccioline, 1 satellite) fuse da un filtro "goo" (blur + soglia alfa).
- Ogni volume è una particella con massa e molle smorzate separate per posizione e raggio. Ha inerzia, overshoot, si allunga fino al 14% nella direzione del moto, respira con ritmi propri non sincronizzati e viene attratto dolcemente dal cursore con una scia.
- **Nascita all'apertura della pagina**: una bolla madre si gonfia al centro, i volumi gemmano uno alla volta in senso orario con un leggero vortice, poi la madre si divide nelle due goccioline.
- **Cambio di stato**: i volumi vengono rilasciati in un ordine sensato, così la forma "scorre" invece di saltare.
- Le superfici nitide (composer, pill, nodi) compaiono sopra la materia solo quando si è assestata. Il goo resta 3px all'interno, così non si vede mai un bordo morbido.

### 4.3 Composer
- È la capsula nera di comando. Contiene, da sinistra:
  - pulsante "+" che apre la palette comandi;
  - eventuale chip del task selezionato (rimovibile);
  - campo di testo;
  - "Clear";
  - pulsante Invio, che diventa l'unico volume bianco quando c'è testo.
- Placeholder: "Describe what you need" senza progetto, "Change the workspace" con un progetto, "Ask about {task}" con un task selezionato.
- Senza progetto sta al centro con i suggerimenti sotto; con un progetto sale dalla capsula in basso con i suggerimenti sopra.
- Comportamento all'invio:
  - se il comando riesce, si chiude;
  - se è un chiarimento o un "non supportato", resta aperto con il testo intatto.
- Cliccare su elementi del workspace non lo chiude: puoi selezionare un task mentre è aperto.

**Suggerimenti contestuali.** Fino a 4 chip che propongono solo cose che FORM sa fare.
- Senza progetto: "Create a timeline for my project", "Create a project tracker for my new website", "Create a board for my new website".
- Con un progetto: offerte di viste da creare, azioni sul task selezionato, "Accept them" / "Discard" se c'è una proposta, ecc.

**Palette comandi** (pulsante "+", "Commands").
- Elenca tutte le frasi supportate, raggruppate: Create, Decide, Add a view, Layout, Brief, Team, Moodboard, Selected task.
- Si filtra mentre scrivi; ogni voce si esegue con un clic.
- I gruppi non disponibili sono disattivati con "Create a project first" o "Select a task first".

**Storico comandi.** ↑/↓ nel campo (ultimi 20, solo per la sessione). Tab a campo vuoto inserisce il primo suggerimento.

### 4.4 Caption
La caption è l'unico canale verbale.
- Una riga in vetro sopra l'agente, al massimo 280 caratteri.
- Un pallino ne indica il tono:
  - pieno = fatto;
  - anello = proposta;
  - anello tratteggiato = chiarimento o non supportato.
- Ha un pulsante "Undo" quando la modifica è annullabile e una ×.
- Sparisce dopo 6.5s, oppure dopo 14s per proposte e chiarimenti.
- Le nuove viste vengono sempre annunciate ("Team view added · Marta over capacity").

### 4.5 Nodi suggeriti
Quando l'agente è a riposo in basso, dalla sua materia gemmano fino a 3 capsule nere: le viste non ancora create, più correlate all'ultima creata.
- Sono alte quanto la capsula "Ask FORM" (46px). Su desktop stanno in catena alla sua destra; su telefono in riga sopra.
- Etichette: "+ Timeline", "+ Board", "+ Team", ecc.
- Passando sopra un nodo, la capsula mostra il comando esatto che verrà inviato ("Add a timeline").
- Cliccandolo, la vista viene creata esattamente come se l'avessi scritto: caption con Undo, tab nuova, poi gemmano i nodi successivi.
- Mappa delle correlazioni:

| Ultima vista creata | Nodi proposti |
|---|---|
| Tracker | Timeline, Board, Team |
| Board | Focus, Timeline, Team |
| Timeline | Team, Board, Brief |
| Team | Brief, Timeline, Focus |
| Focus | Timeline, Team, Brief |
| Brief | Timeline, Team, Tracker |

- Quando l'insieme cambia (vista aggiunta o annullata), i nodi rientrano nell'agente e rinascono: non scivolano mai uno nel posto dell'altro.
- Sono nascosti mentre:
  - un task è selezionato;
  - c'è una proposta o un piano in sospeso;
  - il composer o l'intro sono aperti.

### 4.6 Point & Ask
Selezionare un task (badge numerato, superficie della card, barra della timeline, volume del Focus, riga del Team, nome del task nel brief) lo rende il soggetto implicito del comando successivo ("this", "it", "that").
- Il composer lo mostra come chip di contesto e la capsula "Ask FORM" mostra il suo titolo.
- I comandi non selezionano mai niente da soli.
- Si deseleziona cliccando nel vuoto o con Esc.

### 4.7 Scorciatoie
- "/" apre il composer.
- ⌘K / Ctrl+K lo apre e chiude.
- ⌘Z annulla, ⇧⌘Z ripete.
- Esc chiude il composer, poi toglie la selezione.
- Barra di progresso: frecce ±5%, Home/End.
- Moodboard: Backspace/Delete rimuove l'elemento selezionato.
- Titoli inline: Invio salva, Esc annulla.

### 4.8 Top bar
- A sinistra: il logo in una capsula di vetro (mini-agente + "FORM").
- A destra:
  - stato del motore;
  - ⓘ "About this project";
  - Undo e Redo circolari;
  - "Reset demo", annullabile.
- Su schermi molto larghi, metadati agli angoli in basso: "FORM / 01 — Adaptive workspace", "Intent → interface", "{n} changes · saved locally" e le scorciatoie.

## 5. Progetto, template e dati

**Template.** Esiste un solo template: un sito web.

| N. | Task | Stato | Priorità | Progresso | Durata | Owner |
|---|---|---|---|---|---|---|
| 01 | Research | Done | Low | 100% | 3 giorni | Sara |
| 02 | Visual Direction | In review | High | 85% | 4 giorni | Marta |
| 03 | UI Design | In progress | Urgent | 30% | 6 giorni | Marta |
| 04 | Development | To do | Medium | 0% | 8 giorni | Luca |

**Team di esempio**
- Marta, Art director, capacità 7 giorni;
- Sara, Designer, 8 giorni;
- Luca, Developer, 10 giorni.

Marta parte apposta con 3 giorni di troppo, così "bilancia il carico" ha qualcosa da risolvere.

**Calendario.** Data di inizio di esempio: lunedì 28 settembre 2026. Il calendario risultante dura 21 giorni:
- Research 28.09–30.09;
- Visual Direction 01.10–04.10;
- UI Design 05.10–10.10;
- Development 11.10–18.10.

Qualunque soggetto si chieda, nasce questo template: cambia solo il titolo, e la caption avvisa "Demo mode ships one template (website) — rename anything".

**Task**
- Campi: titolo, stato (To do / In progress / In review / Done), priorità (Low / Medium / High / Urgent), progresso 0–100, durata in giorni (oppure vuota), costo in euro (oppure vuoto), enfasi, owner, passi (sottotask a un solo livello).
- Stato e progresso sono allineati quando cambia uno solo dei due:
  - mettere Done porta il progresso a 100;
  - portare il progresso a 100 segna Done;
  - abbassarlo su un task fatto lo riporta in corso.
- La coerenza non è garantita in ogni caso. Combinazioni misurate: Done al 40% se un comando imposta entrambi, In review o In progress al 100% partendo da Done, In review allo 0% partendo da To do. Trascinando lo slider di un task In review oltre il 100% e poi indietro, il task finisce In progress.

**Creazione del progetto**
- Un progetto può nascere solo come Tracker, Board o Timeline.
- "Create a timeline for my project" crea il progetto con la sola tab Timeline.
- Se chiedi di crearlo come Team, Focus o Brief, FORM risponde: "A project starts as a tracker, board or timeline. Try 'Create a timeline for my project', then add the Team view."
- Con un progetto aperto, nominare una vista ("Create a timeline for my project") aggiunge quella vista. Solo una richiesta esplicita di un nuovo progetto ("Create a new project", "Start another project") sostituisce quello aperto.

**Viste**
- Le viste create sono tab nell'ordine di creazione.
- Una vista si rimuove a comando ("Remove the board", anche hide / delete / get rid of): si chiude solo la tab, i dati non si toccano, e l'ultima vista non si può rimuovere.

## 6. Le sei viste (rappresentazioni dello stesso dato)

In alto c'è sempre l'header:
- eyebrow mono "Project · {Vista}";
- titolo del progetto, modificabile cliccandoci sopra;
- sottotitolo, es. "4 tasks · sample start 28 Sep".

A destra dell'header:
- la barra delle tab: capsula di vetro con un cursore d'inchiostro scorrevole sulla tab attiva;
- i controlli di vista:
  - "Sort" con le opzioni Workflow, Priority, Progress, Status, Name, Duration;
  - interruttori "Compact", "Hide done", "Urgent".

Quando nasce una vista, la sua tab si allarga alla larghezza reale (il vetro si allarga, niente scala). L'inchiostro aspetta sulla tab precedente e scivola sulla nuova solo dopo; Undo la richiude.

### 6.1 Tracker (cards)
Card di vetro in griglia responsiva (4 colonne di default) oppure, in modalità compatta, righe a capsula alte 46px (2 colonne).

**Card**
- chip di stato;
- titolo modificabile;
- grande percentuale;
- durata con +/−;
- slider di progresso trascinabile (scatti del 5%);
- puntini di priorità cliccabili, il quarto diventa rosso se Urgent;
- tag del costo;
- elenco dei passi con spunta e rimozione;
- badge numerato nell'angolo;
- un task "enfatizzato" diventa nero, con titolo più grande, e occupa 2 colonne.

**Comandi di layout e filtro**
- layout a lista o griglia, numero di colonne 1–4;
- nascondere i task fatti, con stato vuoto "Everything here is filtered out." e pulsante "Show completed tasks";
- evidenziare gli urgenti: gli altri si attenuano al 55%;
- nascondere o mostrare durata, priorità e progresso.

**Transizioni.** Il passaggio card ↔ riga è un morph della stessa superficie: il contenuto si dissolve e si ricondensa dentro una finestra ritagliata, senza stiramenti.

### 6.2 Board (kanban)
- Quattro corsie di vetro: To do, In progress, In review, Done (tre se i fatti sono nascosti). Ogni corsia ha intestazione con glifo, etichetta e contatore.
- Card più piccole con titolo, priorità, costo, durata, slider e passi. All'hover compaiono le frecce "← To do" / "In review →" per spostare la card di una corsia.
- Le card del tracker si trasformano in card della board con un morph condiviso.
- Non c'è drag-and-drop tra le corsie.

### 6.3 Timeline
Pannello di vetro con un diagramma a giorni.

**Struttura**
- colonna etichette con numero, stato e titolo modificabile;
- righe dei giorni, linee più marcate il lunedì, weekend ombreggiati, etichette di settimana;
- linea "Today" in inchiostro.

**Barre**
- ogni task è una barra a capsula dalla data di inizio derivata alla fine;
- riempimento d'inchiostro secondo il progresso, con spunta se fatto;
- percentuale dentro o accanto, intervallo "DD.MM–DD.MM".

**Passi e task senza durata**
- i passi sono righe rientrate con barre sottili dentro la finestra del task padre;
- i task senza durata mostrano "Needs a duration" con "+ Duration".

**Piede del pannello.** "Sample schedule · derived from estimates in workflow order" e un controllo "Start ‹ 28 Sep 2026 · sample date ›", che sposta l'inizio di ±7 giorni e rende le date reali.

**Animazioni**
- La vista si costruisce da sé: le etichette si condensano e le barre si aprono dalla loro data di inizio con un clip-path.
- Le proposte di passi compaiono come barre tratteggiate da accettare.

### 6.4 Team (carico di lavoro)
**Righe**
- una riga per persona, più una riga "Unassigned" quando serve;
- la traccia di ogni riga è la capacità in giorni;
- i task aperti sono capsule disposte una dopo l'altra, larghe quanto la loro durata;
- il lavoro oltre la linea di capacità è tratteggiato in rosso;
- avatar con iniziali, cerchiato di rosso se in sovraccarico;
- dicitura del carico, es. "10/7d · +3d over" oppure "Nd free".

**Interazioni**
- trascinare un task sulla riga di un'altra persona lo riassegna;
- trascinarlo su "Unassigned" toglie l'owner;
- un clic semplice lo seleziona.

**Bilanciamento**
- "Balance the workload", oppure il pulsante "Balance with FORM", fa proporre a FORM un piano di passaggi.
- Il piano è un algoritmo greedy che sposta solo lavoro che sta interamente nella capacità di chi lo riceve, preferendo i task meno avviati.
- Appare una card nera "FORM suggests", es. "Move UI Design to Sara — Marta is 3d over capacity. Sara has room for its 6d.", con "Discard" / "Accept".
- L'anteprima è visibile direttamente sulle righe: segmenti in partenza tratteggiati, sagome d'arrivo "from Marta", carichi vecchi barrati e nuovi calcolati.
- L'accettazione è in due tempi: la card si dissolve mentre il task viaggia, poi lo spazio si chiude.

**Persone**
- "Add person" aggiunge una persona; i nomi si modificano in linea.
- Capacità, ruolo e rimozione si gestiscono solo a comando.
- Senza persone compare "No team yet" con "Use a sample team".

### 6.5 Focus
È un palco a tutto schermo che risponde a "What should I work on now?".

**Colonna sinistra: la decisione**
- eyebrow "FORM suggests · 03", oppure "Your focus · 03" se l'hai scelto tu;
- titolo del task in display-xl su una sola riga, ridotto quanto basta per entrarci;
- una frase su dove sta e perché conta, es. "In progress, 30% done. Urgent and overdue on the sample schedule since 10 Oct.";
- capsula nera "Next" con il prossimo passo e "Mark done", oppure "Break it down" se il task non ha passi.

**Colonna destra: il fluido**
- il task in focus è un nucleo d'inchiostro con la percentuale grande e "Complete";
- gli altri task sono volumi più piccoli fusi alla massa con lo stesso goo dell'agente, numerati, che fluttuano lentamente;
- cliccare un volume lo porta in focus e i due si scambiano di posto;
- le card del tracker si trasformano in questi volumi con un morph.

**Come FORM sceglie.** La scelta è deterministica e spiegabile. Punteggio:

| Motivo | Punti |
|---|---|
| Priorità Urgent / High / Medium / Low | 40 / 25 / 12 / 4 |
| In corso | +15 |
| In revisione | +10 |
| In ritardo sul calendario (di esempio) | +35 |
| Giorni indietro rispetto al calendario | 40 × frazione di ritardo, se ≥ 1 giorno |
| Ogni task To do che viene dopo nell'ordine di workflow | +5 (non esistono dipendenze vere) |

Puoi anche fissare tu il task ("Focus on Development"). In Focus l'header si riduce a una riga e metriche, progresso e moodboard si fanno da parte.

### 6.6 Brief (aggiornamento di stato scritto)
È un foglio di carta con il progetto raccontato in prosa. È composto solo dai dati, senza un modello che scrive.

**Struttura**
- eyebrow "Status · 14 Oct · For the client · Sample schedule";
- headline di due frasi, es. "New website is 39% done. UI Design is the one to watch.";
- sottile barra di progresso;
- sezioni Note, Done, In progress, Next, Risks, Open questions;
- striscia "Palette" con i colori della moodboard;
- piede "Composed by FORM from the project data. Nothing is invented: what it doesn't know is listed as a question."

**Cosa non sa → domanda.** Le lacune diventano domande, es. "Dates are indicative until the start date is confirmed.", "X has no duration yet…".

**Destinatario: Client / Team**
- La versione per il team aggiunge gli owner ("…, with Marta"), i rischi di sovraccarico e le domande su owner e costi.
- "Short version" toglie la sezione Done e tiene al massimo 2 frasi per sezione, più tutte quelle scritte dall'utente.

**Copy.** "Copy" copia il brief come rich text (si incolla formattato in Mail, Gmail, Notion e Slack) con fallback in testo semplice. I nomi dei task nel testo sono cliccabili per Point & Ask.

**Modificabile**
- Clic su qualsiasi frase per riscriverla: Invio salva, Esc annulla.
- Invio su una frase svuotata la nasconde; "Show N hidden" la riporta.
- "+ Add a line" sotto ogni sezione, "+ Add a note for the client" sopra tutto.
- Le frasi riscritte restano tue mentre i dati cambiano. Se FORM ora direbbe qualcosa di diverso, appare "FORM's version changed: …" con "Use FORM's" / "Keep mine".
- Client e team hanno modifiche separate.
- "N edits · Reset to FORM's version" annulla tutto per quella versione.

**Animazioni.** Si ri-animano solo le frasi il cui testo cambia.

### 6.7 Blocchi del workspace
- **Header.**
- **Metriche**: striscia di vetro con anello Complete %, Done d/n, Estimate Nd, Urgent n (pallino rosso), più Steps e Known cost quando ci sono. Il progresso è pesato sulle durate.
- **Indicatore di progresso** (aggiunto a richiesta): un segmento per task, largo quanto la sua durata e riempito d'inchiostro secondo il progresso.
- **Collezione**: la vista attiva.
- **Moodboard.**

Ogni blocco entra condensandosi da una sfocatura, senza spostamenti.

## 7. Moodboard

È una tela libera di riferimenti ("References") sotto la vista attiva; non compare in Focus.

**Immagini**
- Si aggiungono trascinandole, incollandole o con "Add images".
- Vengono ridotte a massimo 1600px, in WebP dove il browser lo supporta (altrimenti JPEG, altrimenti il file originale), e salvate nell'IndexedDB del browser; il documento tiene solo un id. Le immagini salvate non vengono mai cancellate dall'IndexedDB.
- Nessun motore può creare immagini da testo.

**Elementi**
- Si trascinano ovunque e si ridimensionano dall'angolo (le immagini restano proporzionate).
- Si rimuovono con × o Backspace.
- Un elemento spostato va in cima alla pila.

**Note.** Testo libero, doppio clic per modificare; il carattere scala con la larghezza.

**Colori.** Picker proprietario:
- campo saturazione/luminosità, capsula della tonalità, hex;
- contagocce (Chromium);
- 8 colori di studio e un nome opzionale.

A comando si possono aggiungere anche hex e 30 colori per nome, 32 nomi contando gli alias "off white"/"off-white" e "grey"/"gray" ("terracotta", "sage"…).

**Disposizioni**
- Masonry: colonne uguali.
- Grid: provini, celle uguali con elementi adattati e centrati.
- Collage: sovrapposto con leggere rotazioni ±5°, deterministico.

Masonry e Grid raccolgono prima i colori in una striscia palette in alto. Le posizioni sono in unità relative alla larghezza della tavola, quindi la composizione scala con lo schermo.

## 8. Cosa si fa direttamente (senza agente)

- Modificare titoli di task, passi, progetto e persone (clic e scrivi).
- Cambiare stato dal menu.
- Trascinare il progresso; un trascinamento è un solo passo di undo.
- Cliccare la priorità; regolare la durata con +/−.
- Spuntare o rimuovere passi.
- Accettare o scartare proposte.
- Spostare card tra corsie con le frecce.
- Spostare l'inizio della timeline di ±1 settimana.
- Riassegnare trascinando nel Team; aggiungere persone.
- Fare tutto il lavoro sulla moodboard.
- Usare toggle e sort.
- Cambiare destinatario e lunghezza del brief, riscriverlo e copiarlo.
- Cambiare tab tra le viste già create.

## 9. Comandi supportati (esempi esatti)

**Creare**
- "Create a timeline for my project"
- "Create a project tracker for my new website"
- "Create a board for my new website"
- "Help me organise my website launch"
- "Create a new project for the launch"
- "new project"

**Viste**
- "Add a timeline", "Add a board", "Add the tracker", "Add the team view", "Add focus", "Add a brief"
- "Show this project as a timeline"
- "Show it as a kanban"
- "Show the schedule"
- "Change back to the original project tracker"
- "Show it as a list"
- "Remove the board" / "Hide the timeline" / "Get rid of the brief"

**Layout**
- "Make the cards more compact and sort them by priority"
- "Make it bigger"
- "Show the tasks in two columns"
- "Sort by name / duration / progress / status"
- "Back to workflow order"
- "Hide completed tasks" / "Show completed tasks"
- "Highlight the urgent ones" / "Remove the highlight"
- "Hide the estimates" / "Show priorities"
- "Add a progress indicator"
- "Show / Hide the metrics"

**Task** (per nome o sul task selezionato)
- "Mark it done", "Mark UI Design in review", "Start Development", "Reopen it"
- "Set it to 40%", "halfway"
- "It takes 2 weeks", "Set the estimate to 5 days"
- "Make it urgent", "Set priority to low"
- "Set the cost to €2,400"
- "Rename it to …", "Call it …"
- "Make this more prominent" / "less prominent"
- "Add a step called QA pass"
- "Delete UI Design"
- "Add a task called Copywriting"

**Passi**
- "Break this task into smaller steps": proposta di 3–4 passi dimensionati sulla durata del task, poi "Accept them" / "Discard".

**Decidere**
- "What should I work on now?", "Help me prioritize", "Focus on Development"
- "Show me everything again", "exit focus"

**Team**
- "Show the team workload", "Who's overloaded?"
- "Balance the workload" → "yes" / "no"
- "Assign Development to Sara", "Give it to Sara", "Unassign Visual Direction"
- "Add Giulia and Paolo to the team as designers with 4 days"
- "Set Marta's capacity to 10 days"
- "Remove Luca from the team"
- "Add a sample team"

**Brief**
- "Write a status update for the client", "What do I tell the client?"
- "Now make it for the team", "Make the brief shorter" / "longer"
- "Add to the brief: homepage preview on Friday"
- "Add to the brief under risks: fonts still unlicensed"
- "Add to the team brief: standup moved to 10"
- "Reset the brief"

**Moodboard**
- "Add a moodboard for the project"
- "Add the colours #0C0C0C, off-white and terracotta"
- "Add a note: warm, tactile, editorial"
- "Tidy up the moodboard"
- "Arrange the moodboard in a grid / as a collage"
- "Clear the moodboard"
- "Hide the moodboard"

**Controllo**
- "undo", "redo", "reset"

**Combinazioni.** Più modifiche in una frase si combinano e le caption si uniscono con " · ", es. "Compact · Sorted by priority".

## 10. Rifiuti e chiarimenti (FORM non indovina)

**Funzioni non presenti**
- Confronti: "Comparison tools aren't in this build yet — the project tracker is the live tool family."
- Budget: "Budget overviews aren't in this build yet. You can give a selected task a cost — e.g. 'set the cost to €2,400'."

**Costi**
- Costo senza importo: "FORM won't invent a cost for {task}. Give an amount…"

**Scomposizione in passi**
- Senza task selezionato: "Select a task first — click its number badge — then ask again."
- Su un passo: "Steps can't be nested further in this build."

**Ordinamento**
- Senza criterio: "Sort by what? Priority, progress, status, name or duration."

**Workspace vuoto**
- "Nothing to shape yet. Start with 'Create a timeline for my project', or a tracker or a board."

**Generico**
- "Demo mode doesn't understand that yet. It handles views, layout, sorting, filtering and task edits."
- Se ha capito il task ma non la modifica: "I understood you mean {task}, but not the change…"

## 11. Animazioni chiave

**Nascita del progetto**
1. Volumi d'inchiostro lasciano l'agente al centro.
2. Volano verso il posto esatto di ogni card (misurato dal DOM), come cerchi.
3. Si gonfiano fino alla sagoma della card.
4. La "pelle" d'inchiostro si raffredda in vetro e il contenuto si condensa.
5. Header e metriche emergono dopo; l'agente si posa in basso.

Durata totale circa 1.75s. Funziona anche se il progetto nasce come board (card delle corsie) o timeline (barre).

**Morph tra viste.** Tracker ↔ righe compatte ↔ Board ↔ Focus sono la stessa superficie che cambia forma, con un layoutId condiviso. Il contenuto vive in una finestra ritagliata, così niente si stira. I badge si muovono solo in posizione.

**Handover.** Timeline, Team e Brief hanno un loro modello spaziale e non fanno morph:
- la vista vecchia sfuma in 0.16s;
- la nuova si costruisce da sé (barre che si aprono, tracce che si srotolano, foglio che sale);
- tornando a una vista a card, questa sale con un leggero movimento verso l'alto.

**Testi.** Ovunque si condensano da una sfocatura, gli eyebrow si decodificano e le etichette dei pulsanti fanno shuffle all'hover. Nel Focus il cambio di decisione è una dissolvenza sovrapposta nella stessa cella, senza salti.

## 12. Architettura tecnica

**Stack.** Next.js 16 (App Router, una sola pagina), React 19, TypeScript, Tailwind v4, Motion (motion/react), GSAP + SplitText, Zustand (con persist), Zod 4, Anthropic SDK.

**Pipeline**
```
comando → interprete (parser demo | Claude) → Operation[] validate con Zod (max 12) → reducer puro → documento condiviso → viste → Motion
```

**Documento.** Contiene: progetto (titolo, data di inizio, blocchi, viste create), task, ordine di workflow, configurazione di vista (vista attiva, densità, layout, colonne, sort, filtri, campi visibili, focus fissato, destinatario e lunghezza del brief), proposta di passi, moodboard, persone, piano di riassegnazione, modifiche al brief.

**Vocabolario: 35 operazioni**, tra cui createProject, setRepresentation (crea la vista se manca), removeView, setView, setFields, updateTask, addTask, removeTask, proposeSubtasks/acceptProposal/discardProposal, addBlock/removeBlock, setStartDate, operazioni moodboard, operazioni team (addPerson, assignTask, proposeReassign…), operazioni brief (editBriefLine, addBriefLine, resetBrief…).

**Parser demo**
- Regole deterministiche con un ordine di precedenza preciso.
- Le righe del brief vengono lette prima del reset, così "add to the risks: DNS needs a reset" aggiunge una riga e non azzera il workspace.
- Vengono riconosciuti il task nominato (titolo più lungo citato) o quello selezionato, salvo frasi al plurale.

**Claude (opzionale)**
- Route server-side `/api/interpret`, modello claude-opus-5-5, effort basso, output strutturato contro lo stesso schema Zod.
- Il prompt di sistema impone le regole di onestà.
- Un sanitizer lato server:
  - scarta id inesistenti;
  - rigenera gli id delle proposte;
  - elimina immagini;
  - applica la regola "una vista per creazione" e la stessa regola del parser su quando sostituire il progetto.
- Errori di rete o di schema ricadono sul parser demo con " · Claude unavailable, demo parser used". Un rifiuto del modello diventa invece una caption "unsupported", senza ricaduta.
- La route non ha autenticazione né rate limit; usa la beta `server-side-fallback-2026-07-01` e `max_tokens: 8000`.
- I nodi suggeriti usano sempre il parser demo.

**Store.** Ogni modifica è un commit atomico con:
- storico undo/redo (60 passi, solo sessione);
- log delle modifiche;
- effetto di transizione (create / shift / reflow / edit / restore, più la vista appena creata, per far crescere la tab).

**Persistenza**
- Documento e log in localStorage ("form.workspace.v1"), rivalidati con lo schema al caricamento; i salvataggi vecchi vengono migrati. Se la validazione fallisce, l'intero workspace viene scartato in silenzio e sostituito da uno vuoto.
- Immagini in IndexedDB.
- Undo, storico comandi e selezione non sono persistiti.
- Flag dell'intro in "form.intro.seen.v1".

**Derivati**
- metriche pesate sulle durate;
- calendario sequenziale dall'inizio, secondo l'ordine di workflow;
- punteggio Focus;
- carichi del team e pianificatore greedy;
- composizione del brief con frasi a id stabile, così le modifiche dell'utente restano agganciate.

## 13. Responsive, accessibilità, reduced motion

**Telefono**
- L'agente scala e il composer si adatta alla larghezza.
- I nodi vanno in riga sopra la capsula e la caption si alza.
- La barra delle tab scorre e va in automatico alla tab nuova.
- Metriche e board scorrono in orizzontale; la timeline scorre dentro il suo pannello.
- Le righe del team impilano l'etichetta sopra la traccia; il Focus va in una colonna.

**Accessibilità**
- Ruoli ARIA su tab, switch, slider e menu; caption in aria-live.
- Etichette su tutti i controlli dell'agente; focus ring visibili.
- Testi animati con copia per screen reader.
- Lacune note:
  - l'intro non ha focus trap;
  - le tab non si navigano con le frecce;
  - nel team e nella moodboard il trascinamento è solo con il puntatore.

**Reduced motion**
- Niente coreografia di creazione e niente pausa di processing.
- Il fluido è fermo nelle sue posizioni.
- Testi e tab compaiono subito.

## 14. Limiti attuali (da non promettere)

- Parser a regole, non un linguaggio libero: frasi fuori schema danno "non supportato". Solo inglese.
- Un solo template (sito web, 4 task, team di esempio, inizio di esempio).
- Niente drag-and-drop nella board; niente riordino manuale dei task da UI; niente date picker (solo ±1 settimana); niente sottotask annidati.
- Layout lista/griglia, colonne e visibilità dei campi solo a comando.
- Capacità, ruolo e rimozione delle persone solo a comando.
- Le immagini della moodboard restano nel browser in cui le hai aggiunte: niente sync, niente account, niente collaborazione multiutente.
- Il punteggio Focus e i rischi del brief usano la data reale contro il calendario di esempio, quindi i "ritardi" dipendono dal giorno in cui si fa la demo.
- La route Claude esiste ma la demo pubblica gira sul parser deterministico se il server non ha una chiave.

## 15. Percorso demo (circa 90 secondi)

1. **Intro**: progetto personale, in sviluppo.
2. **Workspace vuoto**: l'agente-anello al centro. Hover: si raccoglie con "• →". Clic o "/": diventa la capsula di comando.
3. **"Create a timeline for my project"**: i volumi volano, si gonfiano e si raffreddano in barre. Una sola tab Timeline; dall'agente gemmano "+ Team", "+ Board", "+ Brief". Hover: la capsula mostra il comando.
4. **Clic su "+ Team"**: la tab cresce, "Team view added · Marta over capacity". "Balance the workload" → anteprima sulle righe → Accept.
5. **"+ Board"** o "Add the tracker": le stesse superfici cambiano forma. "Make the cards more compact and sort them by priority".
6. **Selezionare UI Design** (badge) → "Break this task into smaller steps" → accettare la proposta.
7. **"What should I work on now?"**: Focus, il task che conta diventa il nucleo e gli altri si fondono nel fluido.
8. **"Write a status update for the client"**: il brief in prosa; "Now make it for the team"; riscrivere una frase; Copy.
9. **"Add a moodboard for the project"**: trascinare immagini, aggiungere colori e note, "Arrange the moodboard as a collage".
10. **⌘Z** per tornare indietro in qualsiasi momento; ricaricare la pagina: tutto è ancora lì.

---

## Errata (audit di Fase 0, 14 ottobre 2026)

Imprecisioni di questo documento trovate confrontandolo con il codice. Le più importanti sono già corrette nel testo sopra. Dettagli ed evidenze in `docs/AUDIT.md`.

1. **Default inventati.** "Add person" usa capacità 10 giorni e "+ Duration" imposta 1 giorno; il campo capacità è obbligatorio, quindi "sconosciuta" non è rappresentabile. *(corretto sopra)*
2. **Reducer non deterministico.** Gli id sono generati con `Math.random` in createProject, addTask, acceptProposal, addPerson, addBriefLine e addMoodItems. *(corretto sopra)*
3. **Coerenza stato/progresso incompleta.** Cinque combinazioni incoerenti misurate. *(corretto sopra)*
4. **Indicatore del motore.** Il piede della palette dice sempre "Demo parser · deterministic". *(corretto sopra)*
5. **Ricaduta su Claude.**
   - Un rifiuto del modello non ricade sul parser. *(corretto sopra)*
   - La route è senza autenticazione né rate limit. *(corretto sopra)*
6. **Sanitizer.** Non controlla `setView.focusId` né gli id e le chiavi delle righe del brief; non aggiusta la caption dopo aver scartato operazioni. Con un progetto aperto lascia passare più `setRepresentation` nello stesso comando.
7. **Persistenza.** Un salvataggio non valido cancella in silenzio il workspace. *(corretto sopra)*
8. **Immagini.** WebP, JPEG o file originale, mai cancellate. *(corretto sopra)*
9. **Contatore "{n} changes · saved locally".** Si ferma a 40, perché il log tiene 40 voci.
10. **Durata della caption.** I 14 secondi valgono anche per le caption "unsupported".
11. **Tetto di 280 caratteri.** Il suffisso " · Claude unavailable…" viene aggiunto dopo il taglio, quindi una caption può superarlo.
12. **Rosso nel brief.** Le righe da rivedere hanno solo un pallino rosso; il testo è grigio. Il rosso come testo compare solo in "Urgent" e "+Nd over".
13. **Evidenziazione degli urgenti.** Task enfatizzati e selezionati non vengono attenuati; nel Team l'attenuazione è al 50%.
14. **Punteggio Focus.** "Lo aspetta" vale 5 per ogni task To do successivo nell'ordine di workflow; i giorni indietro valgono 40 × la frazione di ritardo. *(corretto sopra)*
15. **Volumi del Focus.** Includono i task fatti, come volumi con ✓.
16. **Scomposizione in passi.** L'arrotondamento a mezze giornate può superare la durata del task padre, e la caption dice comunque "fits its Nd estimate", che in quel caso è falso.
17. **Task senza durata.** Nel calendario valgono zero giorni, quindi i task successivi vengono anticipati con date apparentemente certe.
18. **Nomi di colore.** 30 colori, 32 nomi contando gli alias. *(corretto sopra)*
19. **Template unico.** Nasce solo per frasi che il parser riconosce come creazione; "Help me organise my wedding" non crea nulla.
20. **Accessibilità** (lacune sottostimate):
    - segmenti del Team e elementi della moodboard non raggiungibili da tastiera;
    - puntini di priorità di 13×18px;
    - la palette non gestisce il focus;
    - il timer della caption non si ferma.
21. **Comandi senza effetto.** Creano comunque un passo di undo e una voce di log.
22. **Stack.**
    - Versioni: Next 16.4.0, React 19.3.0.
    - `cacheComponents` e `partialPrefetching` attivi.
    - Sei pesi di font con `display: "block"`, tre dei quali inutilizzati.
23. **Point & Ask nel Team.** La riga del Team si seleziona solo con il puntatore.
