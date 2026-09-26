# Baseball Manager (arbetsnamn)

Eventdrivet basebollmanagerspel för webben. Byggs enligt `Baseball_Manager_Implementation_Brief.md` (v0.1). UI-texter och kod är på engelska, dokumentationen på svenska.

## Köra

Kräver Node 20.19+ (utvecklat med Node 24 LTS).

```bash
npm install
npm run dev        # utvecklingsserver, http://localhost:5173
npm test           # alla automattester (cirka 1,5 minut, varav stabilitetstestet står för den största delen)
npx vitest run tests/e2e.test.tsx   # bara end-to-end-flödet
npm run typecheck
npm run build      # produktionsbygge till dist/ (statiska filer, relativ base)
npm run preview    # servera produktionsbygget
```

Produktionsbygget är en statisk webbapp (cirka 430 kB JS, 132 kB gzip). Typsnitten ligger lokalt i bygget, så appen gör inga externa anrop och kräver inga hemligheter, konton eller betaltjänster. Allt kan läggas på valfri statisk webbhost.

Under **Settings** finns testläget "Unlimited Time", som gör det möjligt att spela hela säsonger utan väntan. Testläget visas som "∞ TEST" i toppraden och med en gul banner. I ekonomiläget är taket 12 Time, med +1 var 20:e minut.

## Spelarvärden: OVR och Fitness

- **OVR (overall)** är ett tal 0–100 som visar hur bra en spelare är på sin primära position. Det är ett positionsviktat snitt av grundvärdena (`src/domain/ratings.ts`): försvaret väger tyngre för C, SS och CF, slaget för 1B, hörnytterfälten och DH, och för pitchers är det i praktiken Pitching. Nivåerna är Elite 80+, Good 70+, Solid 60+, Fringe 50+ och Weak. I lineup-listan visas OVR på just den positionen, med avdrag för att spela ur position. Potential-OVR är scoutingens intervall översatt till samma skala.
- **Fitness** är matchberedskap i procent. 100 % betyder fullt redo, och varje procentenhet under det kostar 0,3 ratingpoäng (90 % ger −3, 80 % ger −6).
  - En match kostar en startspelare 3 %, bänken återhämtar 4 % och alla återhämtar 3 % per omgång. En start kostar pitchern 24 %, och vila ger 8 % per omgång.
  - "Rest tired players" bänkar den som ligger under **90 %**. Varning visas under 85 % och "Needs rest" under 80 %.
  - Uppmätt under en säsong ligger ordinarie slagmän i snitt kring 91 % (94 % med rest-valet) och startpitchern kring 97 %.
  - Sparformat v4 räknar om gamla sparfiler enligt fitness = 100 − fatigue × 0,4.
## Acceptanskriterier (brief §16) och hur de verifieras

| Kriterium | Verifiering |
| --- | --- |
| Nytt spel har giltig trupp och ett genomförbart första event | `engine.test` "new game", `e2e.test` |
| Nästa event och primärknappen är tydliga på dator och mobil | Manuellt i webbläsare vid 390, 768 och 1440 px (se nedan) |
| Grundval utan Influence finns; otillgängliga val förklaras | `engine.test`, `stability.test` (varje event i 20 karriärer × 4 säsonger), blocker-text i UI:t |
| Genomfört beslut visar faktiska förändringar och finns i historiken | `engine.test`, `e2e.test` ("What changed" och History) |
| Samma seed och kommandon ger samma resultat, även över sparning och laddning | `engine.test` "determinism" |
| Omladdning, dubbelklick, omrullning och sparfel ger aldrig dubbel kostnad | `controller.test`, `step2.test` (omrullning), `e2e.test` (omladdning) |
| Time vid offlinefrånvaro, full mätare och bakåtklocka; säsongen avancerar inte av frånvaro | `time.test` |
| Giltiga matcher och inningsummor; varje match räknas en gång | `match.test`, `engine.test` "full season" |
| Lineup, fitness och färdigheter ger mätbara skillnader | `match.test` (400 seedade matcher per variant) |
| Ekonomin stämmer mot ekonomiloggen | `engine.test` "reconciles club cash with the ledger" |
| Byten bevarar identitet, flyttar kontrakt och lämnar giltiga trupper | `step2.test` "trades", invarianter i `step2`, `step3` och `stability` |
| Tre uppföljningskedjor reagerar på verkliga val, inklusive brutna löften | `step3.test` kedja 1 (hållet och brutet), 2 och 3 |
| Låga värden hos spelare, ägare och fans ger olika effekter och kan hanteras utan betalning | `step3.test` "low values" |
| Två säsonger kan avslutas, med kontrakt, draft och ny giltig trupp | `step3.test` (50 seedade karriärer), `stability.test` (4 säsonger) |
| Fungerar vid 390, 768 och 1440 px med mus, tangentbord och touch | Manuellt, se nedan |
| Export och import utan förlust; felaktig import förstör inget | `controller.test` |
| Produktionsbygge som webbapp utan hemligheter eller betaltjänster | `npm run build`, `npm run preview` (inga externa anrop) |

### Manuell webbtest (Steg 4)

- **Bredder 390, 768 och 1440 px:** Home, Team, spelarprofil, Club, League, History och Settings med ett spel i gång. Ingen horisontell sidscroll förekommer, och breda tabeller scrollar inuti sin egen ruta.
- **Touch:** alla knappar, länkar och listor är minst 32 px (textlänkar 44 px på touchskärmar). Lineupen ändras med listor och upp/ned-knappar, inte med drag-and-drop.
- **Tangentbord:** piltangenter byter val, Tab går till bekräftelseknappen och Enter bekräftar. Efter ett resultat hamnar fokus på Continue, och efter Continue på det nya eventets rubrik. Synlig fokusmarkering finns överallt.
- **Status visas med text** utöver färg: "Met", "Behind", "Needs rest", tecken på förändringar och "Error:" och "Note:" i lineupen.
- **Migrering:** en riktig sparfil från Steg 1 har laddats (v1 → v3) och spelats vidare in i säsong 3.

## Arkitektur

Spelmotorn är ren TypeScript utan React, DOM, lagring eller systemklocka. UI skickar kommandon (`application/engine.ts → execute(state, command, now)`) och får tillbaka ett nytt tillstånd. All slump kommer från en seedad RNG vars tillstånd sparas i `GameState`.

| Mapp | Ansvar |
| --- | --- |
| `src/domain` | Typer, RNG, lineup-regler, Time-regenerering, nöjdhetsnivåer, effektregistrering |
| `src/simulation` | Matchsimulering, schema, tabell, träning/utveckling, ekonomi, omgångsavräkning |
| `src/events` | Eventmallar, registry, kalenderplanering (slots, cooldown, ersättning) |
| `src/content` | Fiktiva klubbar, startklubbens handskrivna trupp, namnlistor |
| `src/balance` | Alla testvärden (kostnader, formler, trösklar) |
| `src/application` | Kommandon, nytt spel, controller (sparning, retry, konflikt), import/export |
| `src/platform` | `SaveRepository` (IndexedDB + minne), klocka |
| `src/ui` | React-skärmar och komponenter |

### Resolution och sparning

- Eventinstanser har stabila ID:n och status `pending → resolved → acknowledged`.
- `resolveEvent` validerar event-ID, revision, resurser och villkor och beräknar sedan hela nästa tillstånd på en gång: kostnader, utfall, historik, nästa event och RNG-state.
- Controllern sparar resultatet som en enhet innan nästa handling tillåts. Om sparningen misslyckas sparas *samma* beräknade tillstånd igen vid "Retry", så slumpen rullas inte om och ingenting debiteras två gånger.
- Dubbelklick och upprepade kommandon ger `duplicate`, som är en no-op.
- IndexedDB-sparningen gör revisionskontroll, backup-rotation och skrivning i en och samma transaktion. En annan flik som har sparat upptäcks, både via revision och via `BroadcastChannel`.
- Export och import av validerad JSON. En okänd sparversion avvisas och raderas aldrig.
- Äldre sparfiler uppgraderas steg för steg i `application/migrations.ts` (v1 → v2 → v3). Den lagrade kopian ersätts först vid nästa lyckade sparning. En v2-sparfil som stannat vid "Season Complete" förs vidare till nästa säsongs försäsong.

## Steg 4 (balans och webbtest)

- **Kontraktskrav följer marknaden:** kravet baseras på nivå och ålder, inom −15 % till +30 % av nuvarande lön (+10 % om spelaren prioriterar pengar). Tidigare gav varje förlängning en fast ökning.
- **Ekonomi över fyra säsonger** (seeds 1–3):
  - En *försiktig* strategi (förnya unga, sällan värvningar) håller kassan positiv och sänker lönekostnaden.
  - En *vårdslös* strategi (förnya alla, värva ofta) ligger kring noll med en lönekostnad runt $750K. Kriseventen räddar den varje gång.

  Ingen ekonomisk låsning uppstår.
- **`stability.test`:** 20 slumpade karriärer över 4 säsonger. Det finns alltid ett genomförbart val, alltid ett gratis grundval, alla trupper och lineuper är giltiga, kassan är aldrig negativ i mer än 6 omgångar i följd, och sparfilen är under 3 MB.
- **`e2e.test`:** det riktiga React-UI:t, controllern och IndexedDB-adaptern (mot fake-indexeddb) i jsdom. Flödet är nytt spel → säsongsplan → resultat → Continue → "omladdning" (ny controller och nytt UI mot samma databas) → samma event → spela vidare genom en ligamatch → History.
- **Tillgänglighet:** fokus flyttas efter beslut och Continue, och textlänkar har touchstora ytor.

Testerna visar stabilitet, inte att spelet är balanserat eller roligt (brief §16). Balansen bygger på slumpade och enkla strategier. En riktig speltest med människor återstår.

## Steg 3 (långsiktigt ägarskap)

### Säsongscykel

Försäsong (omgång 0) → 20 omgångar → draft → kontraktsbeslut → säsongsgenomgång → nästa försäsong. Spelet fortsätter i obegränsat antal säsonger.

- **Säsongsplan med ägarna** (försäsong). Varje inriktning har mätbara mål som beräknas ur faktiska resultat:
  - *Win now*: minst 12 vinster. Ger +$60K direkt, men fansen reagerar ×1,5 på förluster.
  - *Rebuild*: minst 60 starter av spelare ≤23 år. Fansen reagerar ×0,5 på förluster.
  - *Hållbar utmanare*: minst 10 vinster och säsongens slutkassa minst lika stor som startkassan.
  - Målet utvärderas vid säsongsslut: ägarförtroende ±, Influence och fanbonus.
- **Kursändring:** om laget ligger efter i omgång 7–14 kan planen bytas till rebuild. Den tidigare planen och fansens reaktion på ett övergivet titellöfte ligger kvar i historiken.
- **Säsongsgenomgång:**
  - sponsorbonus och målutvärdering
  - en säsongssammanfattning
  - kontrakt räknas ner, och de som går ut lämnar klubben
  - AI-klubbar förnyar spelare under 33 år
  - åldrande med måttlig nedgång från 31 år
  - billiga ersättare fyller truppen till minst 15 giltiga spelare
  - sponsoravtal räknas ner
  - statistik arkiveras och ett nytt schema skapas
- **Kontraktsbeslut:** förnya alla som vill, bara de ≤28 år, eller ingen. Spelare med nöjdhet under 45 vägrar förnya. Förnyelse ger 10 % löneökning, 20 % för spelare med pengar som prioritet.

### Löften och uppföljningar

- `PromiseRecord` innehåller spelare, mätetal, tröskel, fönster i speltid, ursprungsevent och status. Utvärderingen görs efter varje ligamatch mot de sparade matchlineuperna, aldrig mot text.
- `FollowUp` är en schemalagd uppföljning med ID-referens till ett tidigare event. Kalendern prioriterar i ordningen kris → förfallna uppföljningar → viktade kontextevent, med **högst en prioriterad plats per omgång**. Övriga väntar på nästa lediga plats.

### Tre verifierbara kedjor (automattestade)

1. **Prospect-löfte:** "Lova 2 starter på 3 matcher" → matcherna räknas → hållet (+4) eller brutet (−8, och fansen reagerar om spelaren är populär) → ett uppföljningsevent nästa omgång med nya val: behåll honom i laget, lova igen, erbjud ett program eller stå fast.
2. **Offentligt uttalande:** "Vi bygger något" eller "Vi går för titeln" → fansens reaktion på förluster ändras direkt (×0,5 eller ×1,5, och resultatvyn förklarar varför) → tidningen utvärderar uttalandet mot faktiska resultat fyra omgångar senare.
3. **Träningsinvestering:** Training Center byggs → färdigställs efter byggtiden → nästa omgång börjar med "Training in the New Center", där resultatet visar hur många utvecklingspoäng anläggningen bidrog med.

### Låga värden ger olika effekter (alla hanterbara utan Influence)

- **Spelare** med nöjdhet under 30 → trade request: prata, lova starter, byt bort honom eller vägra. Nöjdhet under 45 → vägrar kontraktsförlängning.
- **Ägare** med förtroende under 35 → ultimatum: utgiftsstopp i 5 omgångar, återhämtningsplan (högre mål) eller att säga emot. Under 50 blockeras byggprojekt, och under 60 går det inte att be om investeringar.
- **Fans** med stöd under 35 → protest: möte, kraftig prissänkning eller att ignorera. Stödet påverkar publiken direkt.

### Strategijämförelse (12 seeds × 2 säsonger, slumpade övriga val)

| Plan | Vinster/säsong | Slutkassa | Ägare | Fans | Mål nått |
| --- | --- | --- | --- | --- | --- |
| Win now | 10,8 | $158K | 66 | 68 | 38 % |
| Rebuild | 10,8 | $152K | 66 | 89 | 29 % |
| Hållbar utmanare | 10,6 | $166K | 69 | 76 | 33 % |

## Steg 2 (hel säsong)

- **20 eventmallar** som täcker alla 12 ursprungliga eventtyper samt säsongsgenomgången:
  - Team Training (standard och "Midweek Session")
  - Individual Training (prospect vill ha större roll, veteran i formsvacka)
  - Fan Interaction ×3
  - Media Coverage (målsättning, magasinsomslag)
  - Board Meeting (avstämning, kassakris)
  - Facility Expansion
  - Free Agent Signing, Tryouts och Draft
  - Trade Offer (veteran mot ungdom, pitcher mot slagman)
  - Sponsor Deal Offering
  - League Game och Season Review
- **Kalender:** varje omgång har två managementevent av olika typ, med vikt, villkor och cooldown. Om ett planerat event har blivit ogiltigt ersätts det av ett giltigt. Kassakrisen tar första platsen i omgången.
- **Omrullning med Influence:** för Free Agents och Tryouts. Kostar 2 Influence men ingen Time, fungerar en gång per eventinstans och sparar de nya kandidaterna direkt.
- **Värvningar:** den nya spelaren får lön från nästa omgång. Signeringsavgift dras direkt. En befintlig starter på samma position reagerar på konkurrensen. Scoutingnivån styr hur osäkert potentialintervallet är.
- **Byten:** spelare och kontrakt flyttas utan att kopieras. Den nya klubben betalar lön från innevarande omgång, och redan utbetald lön stannar. Båda truppernas giltighet kontrolleras vid både erbjudande och resolution (minst 3 pitchers, minst 10 positionsspelare, en catcher, högst 18 spelare).
- **Frisläppning** från spelarprofilen: en buyout på 50 % av resterande säsongslön. Kostar ingen Time.
- **Faciliteter:** ett projekt åt gången. Kräver ägarmandat (förtroende 50+), har byggtid i omgångar och ger högre driftkostnad när projektet är klart. Training ökar progressen, Scouting smalnar av potentialintervallen och Stadium höjer kapaciteten.
- **Sponsorer:** ett kommersiellt avtal (mer pengar men sämre lokal förankring och fanstöd) eller ett lokalt avtal med en top-3-bonus som betalas högst en gång.
- **Negativ kassa:** blockerar frivilliga utgifter. Ett krisevent med två genomförbara val utan Influence tar då första platsen i omgången.
- **Draft efter omgång 20:** en runda i omvänd tabellordning. AI-klubbarna väljer före dig om de ligger lägre. Draftade spelare får lön från nästa säsong.

## Steg 1 (spelbar kärna)

- Startklubb (namn och färg valbara) med handskriven trupp: prospects Miller (21) och Martinez (19), den populära veteranen Brooks och ett ess.
- Liga med 6 klubbar och 20 omgångar. Varje par möts 4 gånger (2 hemma, 2 borta). Tabellen härleds från sparade resultat, så varje match räknas exakt en gång.
- Eventflöde: 2 managementevent och därefter en ligamatch per omgång. Mallar: Team Training (med Influence-boost "Extra coaching"), tre Fan Interaction-mallar (biljettpriser, community day, efter förlust), League Game och en minimal Season Review.
- Matchsimulering per at-bat. Contact, Power, Speed, Fielding, Pitching, fitness och nöjdhet påverkar utfallet. Höjdpunkter bygger enbart på det som faktiskt hände.
- Resurser: Club Cash (ekonomilogg som stämmer mot kassan), Time (tak 12, +1 per 20 minuter, testläge med obegränsad Time) och Influence.
- Feedback: före- och eftervärden, progress mot nästa statpoäng, spelarreaktioner, orsaker till nöjdhetsförändringar och en beslutshistorik.
- Skärmar: Home, Team (roster och lineup-editor utan drag-and-drop), spelarprofil, Club, League, History och Settings.
- Testat i webbläsare vid 390 och 1440 px utan horisontell scroll.

### Tester (46 st, alla gröna)

Idempotens, stale revision, oföränderlig input, grundval utan Influence/Cash, Influence debiteras en gång, hel säsong, ekonomilogg = kassa, lönefördelning summerar exakt, 50 seedade säsonger utan fel, determinism över save/load, Time-regenerering (offline, tak, bakåtklocka, testläge), matchkonsistens (inningsummor, walk-off, ingen sista hemmahalva), mätbar effekt av fitness och förmåga, sparfel/retry, dubbelklick, konflikt mellan flikar, export/import och IndexedDB-backup.

Steg 2 lägger till:
- alla 12 eventtyper och minst 18 mallar
- att varje mall förekommer i 30 seedade säsonger, med truppinvarianter (ingen spelare i två trupper, giltiga trupper)
- omrullning (Influence, ingen Time, en gång)
- lönestart vid värvning
- blockering vid fullt rostertak
- att byten inte kopierar spelare
- kassakris som ger ett betalbart krisevent
- att byggprojekt färdigställs
- buyout vid frisläppning och skydd av sista catchern
- migrering v1 → v2

Steg 3 lägger till:
- 50 seedade karriärer över två hela säsonger (kontrakt, draft, giltig nästa trupp, inga spelare i två trupper)
- löfte hållet och löfte brutet, med uppföljning inom en omgång
- mediakedjan (fanreaktion och utvärdering)
- facilitetskedjan (bidrag i träningsresultatet)
- olika konsekvenser för olika säsongsplaner
- att målutvärderingen matchar de faktiska siffrorna
- låga värden som ger betalbara, olika event samt utgiftsstopp
- kontraktsförnyelse och vägran
- migrering v2 → v3

## Dokumenterade förenklingar (prototypregler)

- Inga errors, hit-by-pitch, bunts, wild pitches eller pinch hitters. Högst ett pitcherbyte per match.
- Från inning 10 startar en löpare på andra bas. Efter inning 15 avgör ett tydligt märkt sudden-death (en viktad dragning, visad som kolumnen "SD").
- Vid walk-off räknas alla runs från det avgörande spelet.
- Rotation: efter varje match föreslås den mest utvilade pitchern som nästa starter. Spelaren kan ändra det på Team-sidan.
- AI-klubbarnas ekonomi simuleras inte. De får autolineups med vila.
- Fans reagerar på resultat relativt prognosen: `round((vinst − vinstchans) × 5)`.

## Arbetsantaganden (ändras lätt i `src/balance/config.ts`)

Alla siffror är testvärden: startkassa $245K, biljettpriser $5–10, lönefördelning 1/20 per omgång (exakt avrundning), fitness-belastning och återhämtning, träningsprogress, boost +50 % för 2 Influence.

## Kvar och kända begränsningar

MVP-stegen 1–4 är klara. Kvar och medvetet utanför MVP:

- **Speltest med människor.** Balansen är bara kontrollerad med slumpade och enkla strategier. Rebuild-målet (60 unga starter) nås i 29 % av de slumpade säsongerna och kräver ett aktivt val.
- **End-to-end i riktig webbläsare** (till exempel Playwright). Dagens E2E-test kör det riktiga UI:t i jsdom. Riktiga webbläsare har testats manuellt.
- **Ljud** saknas. Settings har bara "minskad rörelse", och det finns inga ljudeffekter att slå av.
- **Senare enligt briefen:** pensionering, skador, AI-klubbarnas egna värvningar och ekonomi, slutspel, Medical och Analytics, global räckvidd, akademier, verkliga köp, konton och molnsparning.
- Klientbaserad tid och ekonomi är inte fusksäker. Det är accepterat för en lokal prototyp (brief §14).

### Kända begränsningar i Steg 2

- AI-klubbarna gör inga egna värvningar och har ingen egen ekonomi. Deras trupp växer bara via draft och byten.
- Ett motbud i ett byte ("ask for $20,000") avgörs med en slumpdragning med 50 % chans.
