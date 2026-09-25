# Baseball Manager implementationsbrief för webben

Version 0.1 • 25 september 2026 • Mottagare Claude Code

## 1 Uppdrag och hur dokumentet ska användas

Bygg ett spelbart, eventdrivet basebollmanagerspel för webben. Spelaren leder en klubb genom säsonger och fattar beslut om laget, spelarutveckling, ekonomi, faciliteter och relationer. Spelet ska fungera med mus och tangentbord på dator samt touch i mobilens webbläsare. Arkitekturen ska underlätta en senare mobilapp, utan att den behöver byggas nu.

Det viktigaste är en fungerande managementloop där besluten ger snabb återkoppling och bestående konsekvenser. Bygg inte enbart ett dashboard med statiska siffror eller fristående slumpmässiga händelser.

Dokumentet sammanställer idéerna i det bifogade underlaget och den synliga diskussionen om agency och feedback. Det innehåller också uttryckligt föreslagna avgränsningar för att göra en första implementation möjlig.

### Beslutsstatus

- **Kärnkrav:** uttryckliga idéer från uppdragsgivaren. Dessa ska bevaras.
- **MVP-förslag:** arbetsbeslut i denna brief. Använd dem som standard för prototypen om inget annat anges, men håll dem lätta att ändra.
- **Senare:** idéer som ska bevaras men inte implementeras i första versionen.

Alla exakta antal, kostnader, gränsvärden, formler och teknikval nedan är MVP-förslag, inte tidigare fastställd balans. Namnet Baseball Manager är ett arbetsnamn. Denna brief gäller inte Gjald eller Runmaster.

## 2 Spelvision och kärnkrav

Inspirationen är klassiska Championship Manager: spelaren flyttar tiden framåt och möter matcher, nyheter, träning, rekrytering och andra beslut. Mobilidéens tydliga eventflöde ska behållas i webbversionen.

Kärnkraven är:

1. Nästa event visas alltid centralt på hemskärmen, med en tydlig handlingsknapp under eventet.
2. I princip varje event innehåller ett meningsfullt beslut. Händelser utan val används sparsamt som återkoppling.
3. Besluten påverkar stats, resurser, relationer eller framtida möjligheter.
4. Spelaren får snabbt se att besluten spelar roll och utvecklar ägarskap över sitt lag.
5. Det finns långsiktiga vägval kring bland annat win now, ungdomsutveckling, ekonomi, faciliteter, varumärke och fans.
6. Enskilda spelares nöjdhet, ägarnas förtroende och fansens stöd är olika värden med olika effekter.
7. Eventkapaciteten är begränsad av en tidsrelaterad resurs.
8. En managementvaluta kan påverka eller förbättra val, exempelvis genom boost eller omrullning.
9. Monetiseringsmöjligheter ska finnas genom stora delar av eventflödet. I prototypen simuleras ekonomin utan riktiga köp.

Spelarens centrala drivkraft ska vara: Vad händer härnäst med laget jag håller på att bygga?

## 3 Första spelbara versionen

### Omfattning

MVP-förslag: singleplayer med fiktiva klubbar och spelare. Ingen licensierad liga eller fullständig simulering av en verklig ligas regelverk.

| Område | Första version |
| --- | --- |
| Liga | 6 klubbar, varav 1 styrs av användaren |
| Säsong | 20 omgångar; varje klubb möter varje annan klubb 4 gånger, 2 hemma och 2 borta |
| Säsongsavslut | Serieledaren blir mästare; slutspel senare |
| Trupp | 15 spelare per klubb, med säkerställd positionsfördelning |
| Eventrytm | Normalt 2 managementevent före varje match samt kort försäsong och eftersäsong |
| Innehåll | Minst 18 eventmallar fördelade över de 12 ursprungliga eventtyperna |
| Tidshorisont | Minst 2 sammanhängande spelbara säsonger |
| Matchpresentation | Simulerat resultat, inningöversikt och några faktabaserade höjdpunkter |
| Sparning | Automatisk lokal sparning, export och import |
| Betalning | Inga verkliga köp, annonser eller betaltjänster |

Spelaren börjar med en färdig klubb och kan ändra klubbnamn och färg. Klubben har en etablerad profil, ett par prospects, en populär veteran och en ekonomisk situation som skapar val utan omedelbar kris.

### Utanför MVP

Multiplayer, konton, molnsparning, live service, verkliga betalningar, appbutikspublicering, detaljerad farm league, internationella akademier, full pitch-by-pitch-simulering, 3D, avancerade agentförhandlingar och generativ AI under spelandet.

Att spela över webben betyder här att spelet laddas från en webbplats. Det betyder inte att en server måste simulera varje beslut.

## 4 Core loop och eventflöde

1. Hemskärmen visar nästa event, dess sammanhang och eventkostnad.
2. Spelaren öppnar eventet utan att förbruka resurser.
3. Eventet presenterar normalt 2–3 grundalternativ med tydliga avvägningar.
4. Spelaren kan välja en relevant managementförstärkning om sådan finns.
5. Knappen under eventet bekräftar det valda beslutet och visar total kostnad.
6. Beslutet genomförs en gång. Kostnader, utfall och följder sparas tillsammans.
7. En resultatvy visar vad som ändrats och varför.
8. Spelaren fortsätter till nästa event, som redan har skapats och sparats.

Använd stabila eventinstans-ID:n och en tydlig status: `pending`, `resolved`, `acknowledged`. Att stänga en vy, byta sida eller ladda om får inte skapa nya alternativ, debitera igen eller rulla om ett resultat.

### Kalender och prioritet

Matcher ligger på ett fast spelschema. Managementevent fyller platser mellan matcherna. Kalendern ska inte vara en oändlig helt slumpmässig kö.

Prioritera förfallna löften och uppföljningar, därefter säsongsbundna event, därefter viktade kontextevent. Normalt högst en akut extra händelse mellan två matcher. Återstående uppföljningar får nästa lediga plats, så att matcherna inte skjuts undan av en eventstorm.

Event ska ha villkor, vikt och cooldown. Ett trade-event behöver en giltig motpart och spelare; en kontraktsuppföljning behöver ett giltigt kontrakt. Om villkoren inte längre gäller väljs en giltig ersättningshändelse. Uppdrag som blivit omöjliga ska avslutas med en begriplig orsak.

## 5 Feedback och ägarskap

Feedbacken ska följa kedjan beslut, synlig förändring, reaktion och eventuell senare konsekvens.

### Direkt feedback

Visa faktiska förändringar med före- och eftervärden, inte enbart animationer eller texten att något gick bra. Exempel: en prospects nöjdhet 54 → 62, klubbkassa −8 000 eller Training Center nivå 1 → 2.

Skilj på säkra effekter och osäkra utfall före valet. Efter valet visar resultatet det faktiska utfallet. Avrundning får inte dölja små förbättringar; visa vid behov utvecklingsprogress mot nästa statpoäng.

### Personlig och långsiktig feedback

Använd samma namngivna spelare i träning, lineup, media och kontrakt. Visa porträtt eller initialavatar, roll, personliga prioriteringar och korta reaktioner. En ungdom som får chansen ska inte bara vara en anonym bonus.

Spara en historik över viktiga beslut. Uppföljningar ska hänvisa till verkliga tidigare händelser via ID, exempelvis att en spelare fått ett löfte om starter. Hitta inte på kausala samband. En bra match efter träning kan beskrivas som en stark insats efter träningssatsningen, men inte som garanterat orsakad av den om simuleringen inte stöder det.

Minst tre kedjor i MVP ska ha tydlig återkoppling inom 1–3 efterföljande event eller matchomgångar:

- Ge en prospect en roll → följ upp speltiden → nöjdhet och utveckling.
- Kommunicera en rebuild → fans accepterar vissa resultat bättre → utvärdering mot löftet.
- Investera i träning → anläggningen färdigställs → nästa träningsresultat visar bidraget.

## 6 Resurser och ekonomi

| Resurs | Funktion | MVP-förslag |
| --- | --- | --- |
| Club Cash | Löner, rekrytering, faciliteter och klubbdrift | Interna heltalsbelopp; separat från premiumliknande valuta |
| Time | Begränsar antal genomförda event | Tak 12, kostnad normalt 1 per event, återhämtning 1 per 20 verkliga minuter |
| Influence | Managementvaluta för kontroll och förstärkning | Start 10; mindre belöningar från mål och säsongsavslut; kostnader konfigurerbara |

### Två olika tidsbegrepp

**Speltid** styr matcher, löner, kontrakt, byggprojekt, utveckling och löften. Den går bara framåt genom event och matcher.

**Verklig tid** används enbart för återhämtning av Time i ekonomiläget. Frånvaro ska inte simulera förluster, kontraktsproblem eller missnöje.

Alla ordinarie event, även matcher, kostar Time i föreslagen testmodell. Detta bevarar idén om en eventbegränsning. Undantaget att bara begränsa frivilliga event är en alternativ design att testa senare, inte ett beslutat byte av grundmodell.

Vid noll Time går det fortfarande att läsa information, ändra lineup och planera. Visa återstående väntetid tydligt. Resultatvyer, navigering och bekräftelsen efter redan genomfört event kostar inget. Att tacka nej till ett erbjudande räknas som eventets beslut och kostar normal Time; att bara stänga vyn gör det inte.

Ha ett tydligt märkt testläge med obegränsad Time så att hela säsonger kan testas utan väntan. Ha också ekonomiläge för att testa begränsningen. Inga dolda testpåfyllningar i normal ekonomi.

### Influence

MVP implementerar två användningar: boost av ett valt träningsutfall och omrullning av kandidater vid rekrytering. Övriga eventtyper kan ha relevanta förstärkningar, men ska inte tvingas in i samma mall.

- Boost väljs före bekräftelsen och debiteras tillsammans med eventet.
- Omrullning är en egen uttrycklig betalhandling. Den kostar Influence men inte extra Time, sparar nya kandidater direkt och får göras högst en gång per eventinstans.
- Låt inte omrullning återställa klubbens problem eller redan inträffade matchresultat.
- Det ska alltid finnas minst ett genomförbart grundval utan Influence eller extra Cash, exempelvis att avstå.
- Köp inte bort alla intressekonflikter. En boost ska inte automatiskt göra fans, ägare och samtliga spelare nöjda.

Exakta intäkter, kostnader och regeneration är testvärden. Verklig monetisering, köp av Time och eventuell konvertering mellan resurser beslutas senare.

### Klubbekonomin

MVP har biljettintäkter på hemmamatcher, ett aktivt sponsoravtal och löpande löne- och facilitetskostnader. Visa en prognos för säsongens återstående intäkter och åtaganden före större investeringar.

Löner anges per säsong. Debitera 1/20 av aktuell säsongslön per matchomgång, oavsett hemma eller borta. En spelare som ansluter betalas från nästa omgång och framåt. Ett spelarbyte flyttar framtida lön men återför inte tidigare utbetalda löner. Hantera avrundning konsekvent i sista omgången.

Faciliteter har engångskostnad, byggtid i matchomgångar och driftkostnad efter färdigställande. Sponsorer har löptid, grundersättning och eventuella tydliga bonusvillkor; samma intäkt får inte betalas flera gånger.

Om kassan blir negativ genom obligatoriska kostnader: blockera nya frivilliga utgifter och prioritera ett återställningsevent med ett genomförbart alternativ, exempelvis ägarstöd mot lägre förtroende. Spelaren ska inte fastna i en olösbar kö. Konkurs eller avsked som slut på spelet ingår inte i MVP.

## 7 Spelare och lagbygge

Varje spelare har stabilt ID, namn, ålder, positioner, aktuella färdigheter, utvecklingspotential, fatigue, nöjdhet, popularitet, kontrakt, roll och en personlig prioritet.

Föreslagna stats på skalan 0–100: Contact, Power, Speed, Fielding samt Pitching för pitchers. Potential begränsar långsiktig utveckling. Personliga prioriteringar kan vara speltid, titlar, pengar eller lojalitet. Börja med en prioritet per spelare.

Använd åtta defensiva positionsspelare, en designated hitter och en separat starting pitcher. Det ger nio slagmän och totalt tio aktiva spelare. En starttrupp på 15 består av elva slagmän inklusive reserver och fyra pitchers. Detta är en förenklad spelmodell, inte ett anspråk på full ligarealism.

Spelaren kan välja starters, bänk och pitcher. Lägg till automatisk giltig lineup som hjälp. Trades och värvningar måste kontrollera att truppen fortfarande kan ställa upp; tillåt inte att den sista tillgängliga pitchern försvinner utan ersättare. Inga skador som gör truppen ospelbar i MVP; skador och rehabilitering är senare innehåll.

Prospects förbättras genom träning och speltid. Fatigue minskar prestationsförmågan och kan återhämtas via vila eller att stå över match. Träning och vila är avvägningar. Ålder, kontraktsåterstående och progression följer med till nästa säsong. Äldre spelare får en måttlig åldersrelaterad nedgång enligt konfiguration; pensionering senare.

AI-klubbar behöver enkla, giltiga lineups och egna trupper. Vid trade byter de faktiskt ägare på spelare och kontrakt; de får inte skapa kopior av spelare. Full AI-management behövs inte i MVP.

## 8 Matchsimulering och säsong

Matcher ska vara ett kvitto på lagbygget, inte ett separat actionspel. Före matchen visas motståndare, hemma eller borta, laguppställning, fatigue och en begriplig styrkeprognos. Spelaren väljer exempelvis starkaste laget eller att ge ungdomar chansen genom konkreta lineupändringar.

MVP-förslag: en lättviktsmodell som simulerar at-bats över nio innings med outs, baslöpare och runs. Sannolikheter påverkas av slagmannens Contact och Power, pitcherns Pitching, motståndarnas Fielding samt begränsade modifierare för fatigue och nöjdhet. Speed kan påverka avancemang på baserna. Alla stats som visas ska ha en faktisk användning; annars utelämnas de.

Modellen behöver inte simulera alla basebollregler. Dokumentera förenklingar. Hantera tre outs per halv inning, bortalahalvan först, utebliven sista hemmahalva när hemmalaget redan leder, walk-off och extra innings vid lika. För en enkel men avslutbar prototyp: efter ordinarie extra innings-gräns kan ett tydligt märkt sudden-death-avgörande användas. Detta är en spelregel för prototypen, inte en riktig ligaregel.

Visa inningsiffror och totalpoäng från samma simuleringsdata. Höjdpunkter får endast beskriva sådant som faktiskt inträffat. Enkel presentationsanimation får hoppas över; resultatet ska redan vara fastställt och sparat.

Varje omgång simuleras även de två andra ligamatcherna exakt en gång. Tabellen uppdateras med vinster, förluster och runs. Vid lika antal vinster rangordnas lagen efter run differential, därefter inbördes vinster och sist stabilt ID som prototypens sista skiljekriterium.

Efter 20 omgångar: summering, målutvärdering, sponsoravslut, åldrande, kontraktsutgång, draft och truppkomplettering inför ny säsong. Inför nästa säsong ska lineup åter vara giltig. Billiga ersättningsspelare ska finnas om kontrakt löper ut. Efter två säsonger ska vinster och kostnader av olika strategier gå att se.

## 9 Strategiska vägval

Strategi är en riktning som tar form genom faktiska beslut, inte en klass som ger gratis bonusar när den väljs.

| Dimension | Vägval | Hur den ska märkas |
| --- | --- | --- |
| Sportslig tidshorisont | Win now, rebuild eller hållbar utmanare | Truppålder, speltid, löner och säsongsmål |
| Rekrytering | Utveckla egna, free agents eller trades | Olika investeringar, risker och eventmöjligheter |
| Ekonomi | Aggressiv satsning, kostnadskontroll eller intäktstillväxt | Budgetutrymme och ekonomisk sårbarhet |
| Faciliteter | Träning, scouting eller arena | Olika förbättringar och framtida val |
| Varumärke | Lokal förankring, stjärnprofiler, vinnartradition eller global räckvidd | Fansens förväntningar, sponsorer och event |
| Fanrelation | Tillgängliga priser och lojalitet eller högre kommersiellt uttag | Förtroende kontra intäkter |

I MVP implementeras win now/rebuild som uttalad säsongsinriktning och lokal/kommersiell profil som gradvis föränderliga värden. Övriga riktningar uttrycks genom val och resurser utan egna avancerade system. Global räckvidd, internationell scouting och akademier bevaras som senare expansion.

En säsongsinriktning fastställs vid ägarmöte med mätbara mål, exempelvis antal vinster eller starter för prospects. Ny inriktning kan förhandlas genom event, men skriver inte om historiska löften. Att välja rebuild ska alltså inte omedelbart radera missnöje efter brutna titelutfästelser.

## 10 Nöjdhet och förtroende

| Aktör | Mätare | Viktiga orsaker | Konsekvenser i MVP |
| --- | --- | --- | --- |
| Varje spelare | Satisfaction 0–100 | Roll, speltid, träning, kontrakt och löften | Måttlig prestations- och träningsmodifierare; förlängningsvilja; samtals- och trade request-event |
| Ägare | Confidence 0–100 | Avtalade mål, kostnader och resultat | Investeringsmandat, budgetkrav och uppföljningsmöten |
| Fans | Support 0–100 | Resultat relativt förväntan, priser, profiler och kommunikation | Publikintresse, intäkter och reaktionsevent |

Använd ett sammanfattande lagvärde för översikt vid behov, men ersätt inte individuell spelarnöjdhet med ett genomsnitt. Media, sponsorer och personal är eventaktörer utan egna permanenta nöjdhetsmätare i första versionen.

Visa senaste orsakerna till varje förändring, aktuell nivå och nästa relevanta gräns. Fansens antal och fansens nöjdhet ska vara separata begrepp: en stor publikbas behöver inte vara nöjd.

Föreslagna nivåer: 0–19 kritisk, 20–39 missnöjd, 40–69 neutral, 70–89 positiv och 90–100 mycket positiv. Benämningar anpassas per aktör. Använd cooldown och hysteresis, exempelvis minst 5 poäng över gränsen innan samma larm kan återaktiveras. Förhindra ett nytt krisevent varje gång mätaren växlar mellan 39 och 40.

Alla höga värden ska inte ge samma bonus. Begränsa även kedjereaktioner så att en förlust inte räknas flera gånger genom fans, media och ägare utan uttrycklig regel. Ett svårt läge ska ha möjliga återhämtningsval utan Influence.

## 11 Faciliteter och varumärke

MVP har tre anläggningar med nivå 1–3:

- **Training Center:** ökar mängden utvecklingsprogress vid träning.
- **Scouting Department:** minskar osäkerheten i kandidaters potential; visar intervall innan förbättrad scouting.
- **Stadium and Fan Facilities:** förbättrar publikupplevelse och intäktspotential, men kostar att driva.

Endast ett byggprojekt åt gången. Tillgänglig kassa och ägarnas mandat avgör vad som kan startas. Visa kostnad, drift och färdigomgång före beslutet. Medical Department och Analytics Department kommer senare.

Varumärke byggs genom biljettbeslut, community-event, behandling av profiler och sponsorval. Lokal förankring kan öka tålamod under en rebuild; kommersiell räckvidd kan ge större sponsoravtal. De ska inte automatiskt vara motsatta ändar av en enda skala, och båda kräver investeringar.

## 12 Eventkatalog för första versionen

De 12 ursprungliga eventtyperna behålls. Skriv minst 18 mallar totalt genom flera varianter inom framför allt träning, fans, media, ägare och trades.

| Eventtyp | Exempel på beslut | Omedelbar följd | Möjlig uppföljning |
| --- | --- | --- | --- |
| League Game | Välj starters och pitcher, satsa nu eller vila profiler | Resultat, fatigue, statistik och intäkter | Tabelläge och reaktioner |
| Team Training | Slagträning, försvar eller återhämtning | Utvecklingsprogress kontra fatigue | Effekt i kommande matcher |
| Individual Training | Satsa på prospect eller etablerad spelare | Individuell utveckling och nöjdhet | Rollförväntan |
| Draft | Hög potential eller mer färdig spelare | En ny spelare med kontraktsåtagande | Utveckling nästa säsong |
| Free Agent Signing | Dyrare kvalitet, billigare djup eller avstå | Cash, framtida lön och trupp | Konkurrens om starter |
| Tryouts | Provträna, kontraktera eller avstå | Kandidatinformation och eventuell värvning | Ny utvecklingsmöjlighet |
| Media Coverage | Lova resultat eller kommunicera tålamod | Förväntningar och förtroende | Utvärdera utfästelsen |
| Board Meeting | Förhandla mål eller prioritera budget | Mandat och säsongsmål | Ägarutvärdering |
| Fan Interaction | Sänk priser, möt fans eller behåll linjen | Support kontra pengar | Publik- och mediereaktion |
| Facility Expansion | Träning, scouting, arena eller avstå | Investering och byggprojekt | Färdigställande |
| Trade Offer | Behåll profil eller byt mot ung spelare | Trupp, lön och intressentreaktion | Sportsligt utfall |
| Sponsor Deal Offering | Välj lönsamt eller lokalt avtal, eller avstå | Avtal och brandpåverkan | Bonus eller avtalsutgång |

### Konkret eventexempel

En 21-årig prospect vill få större roll. En populär veteran konkurrerar om samma plats.

- **Lova minst två starter de kommande tre matcherna:** prospect får +8 Satisfaction direkt, veteran får −4. Ett kontrollerbart löfte skapas. Uppfyllt löfte ger ytterligare förtroende; brutet löfte får en tydlig negativ följd.
- **Prioritera individuell träning:** träning kostar Cash och ger utvecklingsprogress, men garanterar inte speltid. Mindre direkt nöjdhetseffekt och ingen konflikt om starter.
- **Behåll nuvarande roll:** kostar inga extra pengar, prospect får −5 Satisfaction, nuvarande lineup bevaras.

Influence kan förbättra träningsalternativets utveckling men köper inte bort veteranens eller prospectens intressen. Alla siffror är testvärden. Löftets utvärdering ska använda faktiskt antal starter, inte textbaserad tolkning.

## 13 Skärmar och interaktion

### Home

Överst visas klubb, säsong, omgång, Cash, Time och Influence. Nästa event är huvudfokus och ska ligga ovanför sekundär information. Visa titel, berörda personer, kort sammanhang och knapp under eventet.

Ägarförtroende och fanstöd är synliga sammanfattningar med tillgång till orsaker. Visa också tabellposition, nästa match och senaste viktiga följder utan att konkurrera med eventets primära handling.

### Övriga vyer

- **Team:** spelare, filter, lineup, roll, stats, nöjdhet och kontrakt. Personkort visar historik och löften.
- **Club:** ekonomi, mål, förtroende, faciliteter, sponsor och varumärkesprofil.
- **League:** tabell, schema och resultat.
- **History:** beslutslogg, orsakssamband och pågående åtaganden.
- **Settings:** ljud, minskad rörelse, sparfil, nytt spel och tydligt avgränsat testläge.

MVP-förslag: engelska UI-texter och kodidentifierare; svensk dokumentation. Samla texter för senare lokalisering.

### Webb först och mobilvänligt

På desktop kan eventet ligga i mitten med klubböversikt och historik vid sidorna. På mobil staplas innehållet; event och primär handling prioriteras. Samma spel och data används på båda.

Testa vid 390, 768 och 1440 pixlars bredd. Undvik horisontell sidskroll, hoverberoende information och drag-and-drop som enda sätt att ändra lineup. Använd tydliga touchytor, tangentbordsnavigation, synlig fokusmarkering och text utöver färg för status.

Visuellt: ett lättläst sportmanagementspel med klubbidentitet, spelarkort, tydlig typografi och lugn bakgrund. Inte en generisk administrationspanel eller ett gränssnitt fyllt av butiksmarkörer. Börja med lokala, enkla grafikresurser utan externa bildberoenden.

## 14 Teknisk riktning

MVP-förslag för ett nytt projekt: React, TypeScript och Vite med vanlig responsiv CSS. Om ett projekt redan finns, inspektera dess instruktioner och struktur innan något ersätts. Använd kompatibla stabila paketversioner och lås dem i projektets lockfil. Briefen föreskriver inga versionsnummer.

Spelmotorn ska vara ren TypeScript utan React, DOM, webbläsarlagring eller direkta anrop till systemklockan. UI skickar kommandon; motorn returnerar nästa tillstånd och strukturerad feedback. Använd en seedad slumpgenerator och en injicerad klocka.

Föreslagen ansvarsfördelning:

| Del | Ansvar |
| --- | --- |
| `domain` | Typer, regler, validering och kommandon |
| `simulation` | Matcher, säsong, utveckling och ekonomi |
| `events` | Mallar, urval, villkor, resolution och uppföljningar |
| `content` | Fiktiva klubbar, spelare och textinnehåll |
| `balance` | Kostnader, formler, skalor och testvärden |
| `application` | Orkestrering av kommandon, sparning och återställning |
| `ui` | Skärmar, komponenter och resultatpresentation |
| `platform` | Lagring, klocka och senare plattformsspecifika adaptrar |

Håll det enkelt: ingen generell skriptmotor eller serverarkitektur behövs för prototypen. Event kan vara typade dataobjekt med deklarativa villkor och ett begränsat register av säkra effektfunktioner. Använd inte `eval` eller exekverbar text från innehållsfiler.

### Centrala dataobjekt

- `GameState`: schemaVersion, revision, seed, RNG-state, klubb, liga, spelare, kalender, resurser, aktuellt event, kö, historik och senast sparade resultat.
- `Player`: stats, potential, ålder, positioner, kontrakt, nöjdhet, fatigue, prioritet, roll och statistik.
- `Club`: trupp-ID:n, Cash, lönebudget, ägarprofil, fanbas, support, brand, sponsor och faciliteter.
- `EventTemplate`: typ, villkor, cooldown, prioritet, val, valfria Influence-handlingar och effektdefinitioner.
- `EventInstance`: unikt ID, mallversion, bundna person-ID:n, frysta erbjudanden, valstatus, omrullningsstatus och resultat.
- `Promise`: ägare, målperson, mätetal, tröskel, deadline i speltid, ursprungsevent och status.
- `EffectRecord`: orsak, mål, före- och eftervärde samt koppling till beslutet.
- `MatchResult`: deltagare, lineup, innings, spelarstatistik och faktiska matchhändelser.

### Resolution och sparning

Ett kommando validerar event-ID och revision, resurser och aktuella villkor. Det beräknar hela nästa tillstånd inklusive kostnader, resultat, uppföljningar och RNG-state. Spara det som en enhet innan UI tillåter nästa ekonomiska handling.

Vid misslyckad sparning visas ett fel och säkert försök igen; rulla inte slumpen eller debitera igen. Dubbla klick och upprepade kommandon ska vara idempotenta. Ett sparat men ännu inte kvitterat resultat visas igen efter omladdning.

MVP-förslag: IndexedDB bakom ett `SaveRepository`-gränssnitt. Spara även en tidigare fungerande snapshot och erbjud export/import av validerad JSON. Versionera sparformatet; vid okänd version ska data inte tyst raderas. Stöd en aktiv skrivande flik eller upptäck konflikt genom revision; två flikar får inte oavsiktligt skriva över varandra.

Time beräknas från sparad återhämtningsreferens och aktuell klocka. Bevara delvis intjänad tid, klampa till tak och tillåt inte negativ återhämtning om klockan går bakåt. När taket nås ska tiden inte fortsätta ackumuleras som en dold reserv.

Klientbaserad tid och ekonomi är inte fusksäkra. Det är accepterat för en lokal singleplayerprototyp, men inte som auktoritativ grund för riktiga köp eller tävlingsrankning.

### Senare mobilversion

Första målet är responsiv mobilwebb. En senare app kan utvärdera Capacitor som behållare för webbgränssnittet. Det är en möjlig väg, inte en garanti om en kostnadsfri port. Native lagring, bakgrundsläge, safe areas, tangentbord, köp och butikskrav måste testas separat. En framtida helt native UI-lösning kan återanvända TypeScript-domänen, men UI-komponenterna kan behöva skrivas om.

Riktiga köp kräver ett separat produktionssteg med serververifiering, idempotenta köptransaktioner och relevant plattformsanpassning. Lägg inte till detta nu.

Tekniska referenser, kontrollerade 25 september 2026:

- React och TypeScript: https://react.dev/learn/typescript
- Vite och projektskapande: https://vite.dev/guide/
- Capacitor och befintliga webbprojekt: https://capacitorjs.com/docs

## 15 Implementationsordning

### Steg 1 Spelbar kärna

Bygg startklubb, Home, Team, sparning, resurser och deterministisk eventresolution. Lägg till Team Training, League Game och Fan Interaction. Det ska gå att genomföra en kort följd av beslut och direkt se följder i laget och klubbens värden. Bygg fungerande logik, inte bara UI.

### Steg 2 Hel säsong

Bygg ligakalender, AI-matchresultat, ekonomi, samtliga 12 eventtyper, minst 18 mallar samt giltiga värvningar och trades. En hel säsong ska kunna spelas och sparas utan manuella ingrepp.

### Steg 3 Långsiktigt ägarskap

Bygg löften, tre verifierbara uppföljningskedjor, faciliteter, brand, ägarmål, åldrande och övergång till andra säsongen. Kontrollera att rebuild och win now ger olika konsekvenser.

### Steg 4 Balans och webbtest

Testa både obegränsad Time och ekonomiläge. Förbättra feedback och responsivitet. Kör automatiska tester och manuell genomspelning. Dokumentera körkommandon, testresultat, förenklingar och kända begränsningar i README.

Prioritera en komplett liten loop framför många halvfärdiga system. Vid osäkerhet ska ett arbetsantagande dokumenteras, inte smygas in som ett fastslaget designbeslut.

## 16 Acceptanskriterier

MVP är klar när följande kan verifieras:

- Ett nytt spel startar med giltig trupp och ett genomförbart första event.
- Nästa event och dess primära knapp är tydliga på både dator och mobilwebb.
- Varje event har minst ett grundval utan Influence; otillgängliga val förklarar varför.
- Ett genomfört beslut visar faktiska förändringar och går att hitta i historiken.
- Samma seed och kommandosekvens ger samma resultat, även efter sparning och laddning.
- Omladdning, dubbla klick, omrullning och sparfel ger aldrig dubbel kostnad eller nya gratis utfall.
- Time regenereras korrekt vid offlinefrånvaro, full mätare och bakåtflyttad klocka; spelsäsongen avancerar inte av frånvaro.
- Matcher har giltiga resultat och inningsummor; varje ligamatch räknas en gång i tabellen.
- Lineup, fatigue och färdigheter används i matchmodellen och kan ge mätbara skillnader över många seedade tester.
- Löner, intäkter och facilitetskostnader kan stämmas av mot ekonomiloggen.
- Trades bevarar spelarnas unika identitet, flyttar kontrakt och lämnar giltiga trupper.
- Tre uppföljningskedjor reagerar på faktiska tidigare val, inklusive brutna löften.
- Låg nöjdhet, lågt ägarförtroende och lågt fanstöd ger olika effekter och kan hanteras utan betalning.
- Två sammanhängande säsonger kan avslutas, inklusive kontrakt, draft och nästa giltiga trupp.
- Spelet fungerar vid 390, 768 och 1440 pixlars bredd med mus, tangentbord och touch.
- Sparfil kan exporteras och återimporteras utan förlorad progression; felaktig import förstör inte befintligt spel.
- Produktionsbygge fungerar och kan serveras som webbapp; inga hemligheter eller betaltjänster krävs.

Automatisera domän- och simuleringstester samt ett end-to-end-flöde för nytt spel, event, sparning, laddning och fortsatt spel. Kör dessutom minst 50 seedade tvåsäsongssimuleringar för att hitta ekonomiska låsningar, tomma eventurval och ogiltiga trupper. Sådana tester visar stabilitet, inte att spelet är balanserat eller roligt.

## 17 Öppna frågor för senare designbeslut

| Fråga | Standard för prototypen |
| --- | --- |
| Hur detaljerade ska matcher vara? | Lättviktig at-bat-simulering, inte taktiska inningbeslut |
| Ska matcher blockeras av Time? | Ja i ekonomiläge; obegränsad Time i testläge |
| Hur tjänas och köps Influence? | Små spelbelöningar; inga riktiga köp |
| Hur hård ska ägarmakten vara? | Budgetrestriktioner och krav, inte avsked |
| Hur autentiska ligaregler behövs? | Fiktiv komprimerad liga med dokumenterade förenklingar |
| Hur ska draft fungera? | En omgång per eftersäsong, omvänd tabellordning; inga tradade draftval |
| Hur många säsonger ska bära innehållet? | Två verifierade; struktur för fortsatt spel |
| Vilken mobilteknik väljs? | Mobilwebb först; native paketering beslutas senare |
| Behövs backend och konton? | Nej för första lokala singleplayerversionen |

## 18 Startinstruktion till Claude Code

Läs hela briefen innan du börjar. Inspektera eventuell befintlig kodbas och följ dess projektinstruktioner. Skapa en kort implementationsplan och börja sedan med Steg 1. Använd kärnkraven som fasta ramar och MVP-förslagen som dokumenterade arbetsantaganden. Bygg en fungerande webbprototyp med verkliga beslut, konsekvenser och sparning; inte bara en mockup. Separera spelregler från gränssnitt och plattform så att en senare mobilversion underlättas. Fortsätt stegvis till acceptanskriterierna, verifiera varje del och dokumentera vad som återstår. Lägg inte till betalningar, konton, multiplayer eller publicering till externa tjänster utan separat uppdrag.
