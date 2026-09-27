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

### Publicering (GitHub Pages)

`.github/workflows/deploy.yml` kör tester och bygge vid varje push till `main` och publicerar sedan `dist/` på GitHub Pages. Om ett test misslyckas publiceras inget.

Engångsinställningar på GitHub:
1. Repot måste vara publikt, eller så krävs GitHub Pro.
2. Välj Settings → Pages → Source: **GitHub Actions**.

Adressen blir `https://dalohn01.github.io/BaseballManager/`. Tack vare relativ base fungerar bygget under den undersökvägen. Varje besökare har sin egen sparfil i sin webbläsare.

Under **Settings** finns testläget "Unlimited Time", som gör det möjligt att spela hela säsonger utan väntan. Testläget visas som "∞ TEST" i toppraden och med en gul banner. I ekonomiläget är taket 12 Time, med +1 var 20:e minut.

## Inför match: Set your lineup

Den gamla vyn med tre val (Your lineup, Strongest, Rest) är ersatt av en laguttagning med tre flikar som redigerar **ett gemensamt utkast** (`src/ui/prematch/`, `src/domain/lineupDraft.ts`).

- **Field:** positionskort på en nedtonad plan (en lista på smala skärmar), bänk och **Proposed swap** med jämförelse.
  - Byten görs med dra-och-släpp, eller genom att klicka ett kort och sedan en bänkspelare. Två kort kan byta position.
  - Om man väljer pitcher-kortet visas övriga pitchers.
  - Den inkommande spelaren tar över position och slagplats. Spel ur position visar det faktiska avdraget (−15 i fielding).
  - Konsekvenser visas: löften som påverkas, "first start in N games" och planerad vila.
- **Batting order:** dra, ▲/▼ eller Alt + ↑/↓. En omordning ändrar aldrig försvarspositionen. Panelen för vald slagman förklarar slagplatsen beskrivande, utan påhittade bonusar.
- **Pitchers:** val av starter (samma utkast som pitcher-kortet i Field) och avvägningen mot det starkaste alternativet, med verklig vinstprognos för båda.
  - Bullpen-plan med rollerna **First reliever / Available / Rest today**.
  - **When to change pitchers:** Early, Balanced eller Let him pitch.
- **Attributes / Stats** och **Season / Last 5 games** gäller hela vyn. Fitness (batteri + %) och Happiness (ansikte + värde) syns alltid. Valen sparas som användarinställningar.
- **Snabbval:** Best lineup, Rotate tired players (<90 %), Suggest order, Suggest setup och Reset. De ändrar bara utkastet, visar vad som ändrades och kan ångras.
- **Bekräftelse:** utkastet sparas per match i webbläsaren, skilt från den bekräftade uppställningen. **Confirm lineup** skickar det i *samma* kommando som spelar matchen, så valideringen, uppställningen, pitchingplanen, Time-kostnaden och matchen hanteras som en enhet. Dubbelklick ger ingen dubbel debitering.

**Motorn följer planen** (`PitchingPlan` på klubben, sparformat v5):
- Den planerade relievern används när startern byts ut. Om ingen är planerad väljs den mest utvilade som inte vilar.
- En pitcher med "Rest today" används aldrig.
- Hook-trösklarna står i `BALANCE.match.hooks`: Early byter efter 22 slagmän eller 4 runs, Balanced efter 27 eller 6 (motorns tidigare regel), Let him pitch efter 32 eller 8.
- Reliever och vila gäller en match, medan hook är en bestående inställning.
- Efter matchen rapporteras vad som faktiskt hände: första start på N matcher, planerad vila med fitness före och efter, om relievern användes, och hur många slagmän startern mötte.

**Statistikdefinitioner:**
- Season hämtas från säsongens boxscore-summor. Last 5 games är klubbens fem senaste matcher.
- OBP = (H + BB) / PA. Modellen har ingen hit-by-pitch, och sac fly räknas som PA utan AB.
- ERA = 9 × runs / IP. Modellen har inga errors, så alla runs är earned.
- IP visas i basebollnotation (10.2 = 10⅔). Tomt underlag visas som "—", och små urval markeras.

**Inte byggt, eftersom motorn saknar stöd:**
- Pitch limit och antal kast, eftersom motorn inte räknar pitches. Belastning visas i stället som mötta slagmän och innings.
- "Looking ahead" (planerad starter till nästa match).
- Mer än ett pitcherbyte per match.
## Match: intro och kommentarsdriven vy

**Flöde:** Confirm lineup → arenaintro (~5 s) → matchen startar automatiskt med autoplay. Det finns ingen extra Start match-knapp och inget mellanliggande event. Uppställningen skickas i samma kommando som spelar matchen, så matchen och Time-kostnaden sker exakt en gång, även vid dubbelklick.

**Intro** (`ui/match/MatchIntro.tsx`):
- Visar hemmalagets arena (`${city} Park`, samma namn som i gate-texterna), Lineup confirmed, lagen och de faktiska startande pitcherna från den sparade matchen.
- Arenan är ritad i kod med hemmaklubbens färger och märke. En textfri målad arenabild kan ersätta den senare.
- **Skip intro** öppnar samma matchstart och hoppar aldrig till resultatet. Med reduced motion blir introt kortare och helt stilla.
- Återinträde i en påbörjad match fortsätter där den var, utan intro.

**Ansvar i tre lager:**
1. **Simulatorn** (`simulation/match.ts`) avgör allt och registrerar `sequence`: varje at-bat, stöld, pitcherbyte, extra-inning-löpare och sudden death. Varje steg har före/efter-läge, löparförflyttningar och outs i ordning.
2. **Kommentarslagret** (`presentation/commentary.ts`) delar upp varje spel i kommentarssteg. Varje steg bär hela det presenterade läget: poäng, outs, baser, löpare på väg, slagman, pitcher och den som just gjort poäng. Text, resultattavla, plan och sidopaneler byter därför alltid på samma steg.
   - Exempel: `BASE HIT! Miller singles.` (slagmannen kvar vid plattan, Chen markerad som Advancing…) → `SCORES! Walker crosses home plate!` (+1, Walker bort från tredje) → `Chen to second. Miller to first.`
   - Uppbyggnadssteg ("Kim delivers to Price…") visas bara när läget före kastet är spännande. De beror aldrig på utfallet och avslöjar därför inget.
   - Tredje out får ett eget steg "That's three outs…", och varje halvinning börjar med ett eget steg. Poäng räknas bara så långt motorn krediterade dem, så inget tas tillbaka.
   - Sista steget i varje spel är exakt motorns efter-läge, och sista steget i matchen är matchens slutresultat.
3. **Uppspelningen** (`presentation/playback.ts`, `ui/match/usePlayback.ts`) har en enda timer för allt.
   - Next moment visar nästa steg direkt och ersätter den väntande timern, så inget dubbeltriggas.
   - Paus håller kvar text och plan. 2× halverar tiderna, och Skip to result visar slutläget.
   - En dold flik pausar klockan, och vid återkomst väntar steget sin fulla tid i stället för att hoppa ikapp.
   - Positionen sparas per match i localStorage, skild från spelets sparfil. Omladdning eller återuppspelning kan därför aldrig skriva resultat, statistik, belöningar eller fitness igen.

**Tempo** (`PACE` i `commentary.ts`): uppbyggnad cirka 1 s, rutin 1,3 s, hit/viktig out 2,1 s, poäng 2 s, förflyttning 1,2 s, inningstart 1,5 s och Final 2,6 s, plus lästid för långa texter. En match tar ungefär 3 minuter i 1× och 1,5 minuter i 2×.

**Vyn** (`ui/match/MatchScene.tsx`, `SchematicField.tsx`):
- Resultattavla med +1 RUN, Live commentary (aktuell kommentar stor, tre tidigare nedtonade, "Play in progress") och At bat/Due up + Pitching.
- Schematisk plan: försvaret som fyllda cirklar med position, anfallet som vita rutor med lagfärgad kant. Bara pitcher, slagman, löpare och den som gjorde poäng namnges.
- Slagordning (Due up/On deck/In the hole), Game so far (R/H/BB/K från redan visade spel), Last run/Just scored och Full match log som bara innehåller visade steg.
- Kontroller: Next moment, Skip to result, Auto play, 1×/2× och Full match log.
- Mobil: kompakt tavla, aktuell kommentar och plan syns tillsammans, med en fastnålad kontrollrad (paus/play som ikon).

**Dataluckor, därför inte påhittat:**
- Motorn har inga enskilda kast, så balls/strikes, count och pitchfart visas inte.
- Försvararen och bollriktningen i `sequence` är hash-metadata, inte motorns avgörande, så kommentarerna namnger ingen fältare och ingen riktning eller slagtyp ("Miller singles", inte "lines to center").
- Äldre matcher utan `sequence` visas som tidigare, som en textbaserad sammanfattning.

**Tester:**
- `presentation.test.ts` kontrollerar 50 matcher: varje spel slutar på motorns efter-läge, inga poäng visas tidigt eller tas tillbaka, och ingen spelare visas dubbelt.
  - Det täcker också exemplet hit → score → settle, att uppbyggnadssteg saknar utfall, tredje out/inningbyte, double play i registrerad ordning och alla händelsetyper.
  - Sidopanelerna räknar bara visade spel, och inga texter nämner fältare eller mph.
  - Autoplay, manuellt och Skip ger samma slutläge, och återupptagning fungerar.
- `e2e.test` går Confirm → Skip intro → Skip to result → Final.

## Club → Facilities

Club har två flikar: **Facilities** (`#/club`) och **Finances** (`#/club/finances`, tidigare Club-sidan).

**Permanenta nivåer** (`simulation/facilities.ts`, `ui/screens/FacilitiesView.tsx`):
- Tre faciliteter med nivå 1–3: Training Center, Scouting Department och Stadium & Fan Facilities.
- Varje kort visar illustration, nivå, nuvarande effekt, nästa nivå och eventuella happenings.
- Detaljpanelen jämför nivå N → N+1, upkeep per säsong, pris, Club funds, pengar efter köp och ökad driftkostnad.
- Effekterna kommer från samma balansvärden som spelet använder:
  - Training: träningsprogress ×1,0 / ×1,2 / ×1,4.
  - Scouting: potentialintervall ±8 / ±5 / ±3.
  - Stadium: kapacitet 7 000 / 8 500 / 10 000.
- **Upgrade** köper nästa nivå direkt med kommandot `upgradeFacility`. Det kostar bara Club Cash, varken Time eller event, och nivån gäller omedelbart.
- Kommandot bär `revision`, så ett dubbelklick eller en andra flik ger `stale` i stället för ett andra köp.
- Köpet syns i Economy log (kategori `facility`). En ny Training Center-nivå schemalägger fortfarande "Training in the New Center".
- **Spärrar med förklaring:** maxnivå, för lite pengar ("needs $80,000, you have …"), negativ kassa, ägarnas utgiftsstopp och ägarförtroende under 50.

**Happenings, tillfälliga och skilda från nivåer** (`club.modifiers`):
- **Local Sponsor Partnership:** 20 % rabatt på nästa uppgradering av en facilitet i 3 matcher. Rabatten förbrukas av köpet.
- **Guest Coaching Clinic:** $8 000 för +15 % träningsprogress i 3 matcher.
- **Floodlight Failure / Training Center Leak:** betala $12 000 för akut reparation, eller acceptera −25 % kapacitet respektive −20 % träning i 2 matcher.
- Modifierarna räknas ned en gång per ligamatch i `settleRound`, efter att matchens biljetter räknats. Vid 0 tas de bort, och matchresultatet nämner "Happening ended: …".
- De visas under **Club happenings** med facilitet, effekt och återstående matcher. Berörda kort får en markering.
- Värdena finns i `BALANCE.facilities.happenings`.

**Äldre sparfiler (schema v6):**
- Alla klubbar får `modifiers: []`.
- Ett köat "Facility expansion"-event blir en happening.
- Ett redan öppet eller förbyggt förslag fungerar fortfarande via den gamla mallen. Den planeras aldrig igen (vikt 0), och ett pågående bygge blir klart som tidigare.

**Tester:**
- `facilities.test.ts` täcker köp en gång, revision-skydd, att ingen Time eller event används, alla spärrar och riktig mekanik (kapacitet).
- Den täcker också rabatt som förbrukas, nedräkning och borttagning över ligamatcher, att happenings aldrig ändrar nivåer och migreringen.
- `facilitiesView.test.tsx` renderar vyn via riktig controller: happenings visas separat, kortet markeras, rabatterat pris köps och "Not enough Club Cash"/maxnivå förklaras.

## Taktik (frivilligt lager)

Allt går att spela utan att någonsin öppna taktiken. Standard är **Balanced** och **Follow team**, och motorn spelar då exakt som före taktiken. Det är verifierat: 40 simulerade matcher gav samma hash som föregående commit.

**Var:**
- **Team → Playing style** (`#/team/style`): lagets sparade stil och en lista över spelare med egna instruktioner.
- **Spelarprofilen:** en hopfällbar sektion Instructions. Den visar bara relevanta områden: slagmän har Batting och Baserunning, pitchers har Pitching.
- **Inför match:** Opponent report med Adjust tactics, och "Change" vid vald slagman och på startkorten. Dialogen gäller **This match only** som standard, med växeln **Save as new default**. Uppställningsutkastet påverkas inte.

**Prioritet** (`domain/tactics.ts`, `resolveTactic`):
1. Spelarens instruktion för denna match.
2. Spelarens sparade instruktion.
3. Lagets matchplan.
4. Lagets sparade stil.

"Follow team" för en match hoppar över spelarens sparade undantag.

**Matchändringar:**
- Visas som "This match: …" med **Reset to usual plan**.
- Rensas i `playRound` efter användarens match. Grundplanen skrivs aldrig över.
- Kommandona är `setTeamStyle`, `setInstruction` och `resetMatchTactics`. De kostar varken Time eller event.

**Effekter i motorn** (`simulation/match.ts`, `tacticShift`, `stealAttempt`, `sendRunner`). Attributen avgör hur väl instruktionen fungerar:

| Område | Val | Effekt |
| --- | --- | --- |
| Batting | Contact | Färre strikeouts (mer med hög contact), färre HR. |
| Batting | Power | Fler HR (mycket mer med hög power), fler strikeouts. Lönar sig för starka slagmän och kostar för svaga. |
| Baserunning | Aggressive | Fler stöldförsök (även långsammare löpare) och extra baser oftare. Löpare som skickas bara på grund av instruktionen kan kastas ut, oftare om de är långsamma. |
| Baserunning | Cautious | Stjäl nästan aldrig och tar färre extra baser, men riskerar inga utkast. |
| Pitching | Attack | Färre walks och startern orkar längre, men fler träffbara kast (mindre för bra pitchers). |
| Pitching | Careful | Färre hits och HR, fler walks, och startern tröttnar tidigare. |

**Kommentarer:** `MatchSequence.tactic` sätts bara när taktiken faktiskt ändrade utfallet.
- Ett stöldförsök som annars inte hade skett.
- En extra bas som annars inte hade tagits.
- En löpare som kastas ut.

Exempel på kommentarer: "Miller takes his chance for second — his aggressive instruction…" och "Chen tries for home on aggressive running and is thrown out."

**Opponent report** (`simulation/opponentReport.ts`): högst tre observationer, märkta Trait, Status eller Recent form.
- **Trait:** catcherns arm och den troliga starterns pitching.
- **Status:** starterns fitness och bullpenens snittfitness.
- **Recent form:** runs per match, bara med minst tre matcher, och märkt "small sample" under fem matcher.
- Tipsen är bara förslag och ändrar aldrig något automatiskt.

**Äldre sparfiler (schema v7):** får `tactics` med Balanced och tomma instruktioner.

**Tester:** `tactics.test.ts` täcker:
- prioritet och sparning, att matchändringar rensas efter matchen och reset
- att bara relevanta instruktioner accepteras, migrering, och att en säsong kan spelas utan taktik
- effektriktningar och att attribut spelar roll
- att kommentarer bara förekommer vid registrerade taktikbeslut, och motståndarrapportens gränser

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
