# Baseball Manager (arbetsnamn)

Eventdrivet basebollmanagerspel för webben. Byggs enligt `Baseball_Manager_Implementation_Brief.md` (v0.1). UI-texter och kod är på engelska, dokumentationen på svenska.

## Köra

Kräver Node 20.19+ (utvecklat med Node 24 LTS).

```bash
npm install
npm run dev        # utvecklingsserver, http://localhost:5173
npm test           # domän-, simulerings- och sparningstester (vitest)
npm run typecheck
npm run build      # produktionsbygge till dist/ (statiska filer, relativ base)
npm run preview    # servera produktionsbygget
```

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

## Status: Steg 3 (långsiktigt ägarskap) klart

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
- Matchsimulering per at-bat. Contact, Power, Speed, Fielding, Pitching, fatigue och nöjdhet påverkar utfallet. Höjdpunkter bygger enbart på det som faktiskt hände.
- Resurser: Club Cash (ekonomilogg som stämmer mot kassan), Time (tak 12, +1 per 20 minuter, testläge med obegränsad Time) och Influence.
- Feedback: före- och eftervärden, progress mot nästa statpoäng, spelarreaktioner, orsaker till nöjdhetsförändringar och en beslutshistorik.
- Skärmar: Home, Team (roster och lineup-editor utan drag-and-drop), spelarprofil, Club, League, History och Settings.
- Testat i webbläsare vid 390 och 1440 px utan horisontell scroll.

### Tester (46 st, alla gröna)

Idempotens, stale revision, oföränderlig input, grundval utan Influence/Cash, Influence debiteras en gång, hel säsong, ekonomilogg = kassa, lönefördelning summerar exakt, 50 seedade säsonger utan fel, determinism över save/load, Time-regenerering (offline, tak, bakåtklocka, testläge), matchkonsistens (inningsummor, walk-off, ingen sista hemmahalva), mätbar effekt av fatigue och förmåga, sparfel/retry, dubbelklick, konflikt mellan flikar, export/import och IndexedDB-backup.

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

Alla siffror är testvärden: startkassa $245K, biljettpriser $5–10, lönefördelning 1/20 per omgång (exakt avrundning), fatigue-belastning och återhämtning, träningsprogress, boost +50 % för 2 Influence.

## Kvar enligt briefen

- **Steg 4:**
  - Balans. Lönerna stiger vid varje förnyelse, och en slumpspelad karriär tappar kassa över tid. Rebuild-målet (60 unga starter) nås i 29 % av säsongerna när övriga val slumpas. Unga spelare får redan cirka 51 starter utan avsikt, så målet kräver ett aktivt val.
  - End-to-end-test i webbläsare för nytt spel, event, sparning, laddning och fortsatt spel.
  - Test vid 768 px och manuell genomspelning.
  - Pensionering, skador och AI-klubbarnas egna värvningar ligger utanför MVP.

### Kända begränsningar i Steg 2

- AI-klubbarna gör inga egna värvningar och har ingen egen ekonomi. Deras trupp växer bara via draft och byten.
- Ett motbud i ett byte ("ask for $20,000") avgörs med en slumpdragning med 50 % chans.
