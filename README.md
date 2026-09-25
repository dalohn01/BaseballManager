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
- Äldre sparfiler uppgraderas steg för steg i `application/migrations.ts` (v1 → v2). Den lagrade kopian ersätts först vid nästa lyckade sparning.

## Status: Steg 2 (hel säsong) klart

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

### Tester (36 st, alla gröna)

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

- **Steg 3:** löften (bland annat "lova starter" i prospect-eventet) och tre verifierbara uppföljningskedjor. Utvärdering av uttalandet i media ("contend" eller "patience" sparas redan). Ägarmöte med säsongsinriktning och mätbara mål, ålder, kontraktsutgång och säsong 2 (draftade spelare väntar redan på den).
- **Steg 4:** balans, end-to-end-test i webbläsare, test vid 768 px och manuell genomspelning.

### Kända begränsningar i Steg 2

- AI-klubbarna gör inga egna värvningar och har ingen egen ekonomi. Deras trupp växer bara via draft och byten.
- Ett motbud i ett byte ("ask for $20,000") avgörs med en slumpdragning med 50 % chans.
