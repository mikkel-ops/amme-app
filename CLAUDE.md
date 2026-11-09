# Amme-app

Simpel amme-tracker som PWA til iPhone. Man starter og stopper en timer for venstre og højre bryst, og hver amning logges med tidspunkt og varighed. Der er også faner til bleskift (tis/lort) og søvn (lure med timer). Den er inspireret af Huckleberry, men er enklere. Ejeren og familien bruger den, bl.a. svigerinden, som har sin egen installation.

- **Live:** https://mikkel-ops.github.io/amme-app/
- **Installationsguide:** https://mikkel-ops.github.io/amme-app/guide.html
- **Repo:** `mikkel-ops/amme-app` (offentligt). Det er kun koden, der er offentlig. Data ligger aldrig i repoet.

## Principper
- **Data kun på telefonen:** al data ligger i `localStorage` på den enkelte enhed. Der er ingen server, ingen konto og ingen synkronisering. Hver person, der installerer appen, får sin egen tomme app.
- **Ingen build-step:** ren HTML, CSS og vanilla JS uden framework og uden npm. Det, der ligger i repoet, bliver serveret direkte.
- **Dansk UI og danske kommentarer i koden.**
- **iPhone/Safari først:** appen skal virke, når den er installeret på hjemmeskærmen (standalone), skal klare safe-area, og iOS Safari er målet.
- Al ny personlig info (navne m.m.) skal kunne indstilles i appen og må ikke hardcodes.

## Filer
| Fil | Indhold |
|---|---|
| `index.html` | Al markup: header, faneblade (`#tabs`), amning (`#mainView`), ble (`#diaperView`), søvn (`#sleepView`), statistik-visning (`#statsView`) og dialoger (`#settings`, `#editDlg`, `#diaperDlg`, `#sleepDlg`) |
| `app.js` | Al logik. Den er opdelt i sektioner med `// ---------- X ----------`: Lagring, Hjælpere, Timer-logik, Drejehjul, Redigering, Visning, Statistik, Faner, Ble, Søvn, Indstillinger + backup, Opstart |
| `style.css` | Farver som CSS-variabler på `:root` (gul `--yellow`, mørkeblå `--ink`), serif-overskrifter (`ui-serif`/New York) |
| `sw.js` | Service worker. Den henter fra netværket først og bruger cachen som fallback, så appen virker offline |
| `manifest.webmanifest`, `icon-*.png` | PWA-manifest og ikoner (blå dråbe på gul baggrund) |
| `guide.html` + `img/guide-*.png` | Installationsguide til iPhone med slørede og annoterede skærmbilleder |
| `guide/` | Rå, uslørede skærmbilleder. **Ligger i `.gitignore` og må aldrig committes.** |

## Datamodel (`localStorage['amme-v1']`)
```js
{
  name: 'Frida',            // barnets navn (vises i headeren)
  lastSide: 'L' | 'R',      // vises som "sidste side"
  active: null | {          // igangværende amning
    start,                  // ms timestamp; kan rettes med drejehjul
    acc: { L, R },          // akkumuleret ms pr. side
    running: 'L'|'R'|null,
    since                   // ms timestamp for hvornår `running` startede
  },
  sessions: [{ id, start, end, L, R }], // L/R i sekunder; sorteret nyeste først
  diapers: [{ id, ts, kind: 'tis' | 'lort' }],  // nyeste først
  sleeps: [{ id, start, end }],         // ms; nyeste først
  sleepActive: null | { start }         // igangværende lur
}
```
- Den forløbne tid beregnes altid som `acc + (now - since)`. Derfor tæller timeren korrekt, selvom telefonen er låst, eller appen er lukket.
- `end - start` er **ikke** nødvendigvis lig med `L + R`, fordi der kan være pauser. Brug `endOf(s)`, som falder tilbage til `start + (L+R)` for gamle data uden `end`.
- Ændrer du formatet, så lav en migrering i `load()`. Brugerne har rigtige data, der ikke må gå tabt.
- `load()` migrerer gamle data ved at tilføje tomme `diapers`/`sleeps` og `sleepActive: null`.
- `amme-hint-closed` i `localStorage` husker, at installationsbeskeden er lukket, og `amme-tab` husker den valgte fane.

## Vigtig adfærd
- **Start/stop:** Når man starter den ene side, sættes den anden på pause. Knappen på den side, der kører, er orange og hedder "Stop venstre" eller "Stop højre". **Gem** logger amningen, og **Annullér** kasserer den.
- **Drejehjul (`class Wheel`, `dateWheels()`):** egne hjul i iOS-stil bygget med CSS scroll-snap og rækkehøjde `ROW = 40`. Time og minut står først og stort, og dagen står til sidst i et smalt hjul ("I dag", "I går", "tor 5/11"), fordi tidspunktet er vigtigere end datoen. De bruges til starttiden på en aktiv amning og til Start/Slut i redigeringen.
- **Redigering (`#editDlg`):** Ændrer man Start eller Slut, står den anden tid stille, og den nye varighed fordeles på siderne efter `ed.ratioL`. Ændrer man minutterne for en side, flytter Slut sig.
- **Gem i redigering** sker i formularens `submit`-handler med `e.submitter.value === 'save'`. Brug ikke dialogens `close`-event til at gemme, for det blev ikke affyret i Chrome, efter drejehjulene havde været brugt.
- **Fokus i dialoger:** Dialog-overskrifter har `autofocus tabindex="-1"`, så iOS ikke åbner tastaturet eller kalenderen, når dialogen åbner.
- **Skjulte elementer:** `[hidden]` bliver overstyret af `display:flex`. Tilføj derfor en `X[hidden]{display:none}`-regel, når du giver en klasse `display`.
- **Statistik:** visningen 7 eller 30 dage har nøgletal og et søjlediagram i inline SVG med én serie i mørkeblå. Gennemsnit pr. dag regnes fra den første dag med data i perioden.
- **Faner:** Amning, Ble og Søvn ligger i en fast bundbar. `applyViews()` viser den rigtige visning, sætter `body.tab-X` (headerfarven via `--head`) og `theme-color`. Statistik-knappen vises kun på Amning, og statistikken dækker kun amninger.
- **Ble:** ét tryk på Tis eller Lort logger med det samme. Tryk på en række i historikken for at rette tid og type eller slette.
- **Søvn:** "Start søvn" sætter `sleepActive`, og "Vågnet" gemmer luren. "+ Tilføj søvn" tilføjer en lur bagefter. `wheelRows()` er en fælles hjælper til dialog-rækker med drejehjul (bruges af `#diaperDlg` og `#sleepDlg`).
- **Backup:** Eksport og import af JSON ligger under indstillinger (⚙︎). Eksporten indeholder amninger, bleer og søvn. Import fletter hver liste efter `id`, og gamle backups med kun `sessions` kan stadig importeres.

## Deploy
GitHub Pages fra `main` (rodmappen). Den deployer automatisk ved push.

1. **Bump `VERSION` i `sw.js`** (`amme-vN` → `amme-vN+1`) ved **hver** ændring, så installerede telefoner henter den nye udgave.
2. Commit og `git push`. Remote bruger HTTPS via `gh auth`, for SSH-push virker ikke på denne maskine.
3. Tjek at Pages-builden er færdig: `gh api repos/mikkel-ops/amme-app/pages/builds/latest --jq .status` skal give `built`.

## Test lokalt
- Start en server med `python3 -m http.server 8765` i repoets rod.
- Headless Chrome har en minimumsbredde på cirka 500px. Indlejr derfor appen i en `<iframe>` på 390px for at få iPhone-bredde. Seed `localStorage` fra en midlertidig testside på samme origin (f.eks. `zz.html`), og slet den bagefter.
- Overskriv `alert`/`confirm` i iframen (`f.contentWindow.alert = ...`), ellers hænger headless Chrome. Kør Chrome med en tidsgrænse.
- Drejehjul i test: sæt `scrollTop` og dispatch `pointerdown` og `scroll` på `.wheel`-elementet.
- Gyldighed tjekkes med `node --check app.js`.
- Skærmbilleder til guiden bliver sløret og annoteret med et Swift/CoreImage-script, der ligger i scratchpad og ikke i repoet. PIL og ImageMagick er ikke installeret.
