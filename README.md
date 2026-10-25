# Macro

Conta calorie e macro per uso personale, per iPhone. Scansioni il codice a barre, scegli i grammi e l'app calcola calorie, proteine, carboidrati e grassi. Niente account, niente server: i dati restano sul telefono.

## Cosa fa

- **Diario** diviso in colazione, pranzo, cena e spuntini, con anello delle calorie rimaste e barre dei macro. Si scorre giorno per giorno.
- **Scanner** dei codici a barre EAN e UPC. I prodotti arrivano da [Open Food Facts](https://it.openfoodfacts.org) e restano salvati sul telefono, così la volta dopo li trovi anche senza connessione.
- **Alimenti base senza codice a barre**: 286 voci tra frutta, verdura, carne, pesce, uova, legumi, pasta, riso, formaggi, frutta secca e bevande. I valori medi vengono da USDA FoodData Central e i nomi sono in italiano, distinti tra crudo e cotto quando serve. Hanno porzioni tipiche ("1 mela media · 180 g") e funzionano anche offline.
- **Ricerca** per nome che ignora maiuscole e accenti ("caffe" trova "Caffè"), tra gli alimenti sul telefono e tra i prodotti venduti in Italia su Open Food Facts.
- **Aggiunta rapida**: solo calorie, ed eventualmente i macro, per un pasto fuori casa.
- **Recenti, preferiti e alimenti creati da te**. Se un prodotto manca o ha valori sbagliati, lo crei o lo correggi copiando l'etichetta.
- **Quantità veloci**: 1 porzione o 30, 50, 100, 150, 200 g, e l'ultima quantità usata viene riproposta. C'è anche **"Copia da ieri"** per i pasti che si ripetono.
- **Obiettivi** calcolati con la formula Mifflin-St Jeor a partire da sesso, età, altezza, peso, attività e obiettivo, con proteine in g/kg e grassi in %. Puoi ritoccarli a mano.
- **Progressi**: grafico del peso (30 giorni, 3 mesi, 1 anno), calorie degli ultimi 7 giorni e medie dei macro.
- **Acqua**, a bicchieri da 250 ml.
- **Backup e ripristino** in un file JSON, da salvare su iCloud Drive.

## I tuoi dati e AltStore

Con AltStore e un Apple ID gratuito l'app scade ogni 7 giorni. **Quando scade i dati non si perdono**: restano sul telefono e li ritrovi appena la rinnovi da AltStore, anche dopo settimane.

I dati si perdono solo se:

- elimini l'app dal telefono;
- reinstalli con un **Apple ID diverso**, perché l'app riceve un identificativo diverso e riparte vuota;
- resetti o cambi iPhone.

Per questi casi c'è **Profilo → Esporta backup**: scegli "Salva su File" e mettilo in iCloud Drive. Con **Ripristina da un backup** riporti tutto com'era. In Profilo l'icona del backup diventa arancione se l'ultima esportazione ha più di 7 giorni.

> Non cambiare `ios.bundleIdentifier` in `app.json` (`com.yurilunardon.macro`). È lui che collega l'app reinstallata ai dati già presenti.

## Sviluppo con Expo Go

Serve Node.js 24 (`.nvmrc`). I test del database usano il SQLite integrato in Node.

```bash
npm install
npx expo start
```

Installa **Expo Go** dall'App Store sull'iPhone e inquadra il QR code con la Fotocamera. iPhone e computer devono essere sulla stessa rete Wi-Fi. Da WSL su Windows il telefono di solito non raggiunge il computer: lancia il server dal Mac oppure usa `npx expo start --tunnel`.

I dati salvati dentro Expo Go **sono separati** da quelli dell'app installata con AltStore. Per provare va bene così. Se vuoi tenerli, esporta un backup da Expo Go e ripristinalo nell'app vera.

Comandi utili:

```bash
npm test            # test di logica e database (calcoli, Open Food Facts, backup, SQL su SQLite di Node)
npm run typecheck   # TypeScript
npm run lint        # ESLint
```

## Installare sull'iPhone con AltStore

### 1. Crea l'IPA sul Mac

Servono Xcode, da aprire una volta per accettare la licenza, e CocoaPods (`brew install cocoapods`).

```bash
npm run build:ipa
```

Lo script genera il progetto Xcode, compila in Release senza firma e crea `build/Macro.ipa`. AltStore lo firma con il tuo Apple ID durante l'installazione.

In alternativa, se il progetto è su GitHub, puoi compilarlo con **Actions → Build IPA → Run workflow** e scaricare l'artifact `Macro-ipa`.

### 2. Installa con AltStore

1. Copia `Macro.ipa` sull'iPhone, per esempio con AirDrop in File, oppure aprilo con AltServer sul Mac.
2. In AltStore: **My Apps → +** e scegli `Macro.ipa`.
3. Ogni 7 giorni: **My Apps → Refresh All**. Per gli aggiornamenti installa il nuovo IPA sopra quello vecchio, con lo stesso Apple ID: i dati restano.

Su iOS 16 e successivi va attivata una volta la Modalità sviluppatore: **Impostazioni → Privacy e sicurezza → Modalità sviluppatore**.

## Struttura

```
src/
  app/                 schermate (Expo Router)
    (tabs)/diary       diario del giorno
    (tabs)/progress    peso e andamento settimanale
    (tabs)/settings    obiettivi, alimenti, backup
    add/               modale "aggiungi": ricerca, scanner, scheda prodotto, nuovo alimento
    entry/[id].tsx     modifica di una voce del diario
  components/          componenti dell'interfaccia
  db/                  SQLite: schema e migrazioni, alimenti, diario, peso/acqua, impostazioni, backup
  lib/                 logica pura e testata: nutrienti, obiettivi, date, Open Food Facts, backup, ricerca
  data/                alimenti base (generati, non modificarli a mano)
scripts/build-ipa.sh   build dell'IPA non firmato sul Mac
scripts/generic-foods/ elenco curato degli alimenti base e script che genera src/data/generic-foods.json
```

Il database è `macro.db` (SQLite) nella cartella Documenti dell'app. Le modifiche allo schema vanno aggiunte come **nuove** migrazioni in `src/db/schema.ts`, così i diari esistenti vengono aggiornati senza perdere nulla.

## Dati

I prodotti confezionati vengono da Open Food Facts, un database libero (licenza ODbL) compilato da volontari: controlla che i valori corrispondano all'etichetta.

Gli alimenti base vengono da USDA FoodData Central, SR Legacy (pubblico dominio). Ci sono due adattamenti. Primo, i carboidrati sono calcolati **senza le fibre**, come sulle etichette europee, mentre l'USDA le include. Secondo, il sale è ricavato dal sodio (× 2,5). Le porzioni sono stime indicative, non dati USDA. Per aggiungere o correggere alimenti:

1. modifica `scripts/generic-foods/foods.tsv`;
2. scarica [lo zip CSV di SR Legacy](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip);
3. lancia `python3 scripts/generic-foods/build.py <cartella del CSV>`;
4. alza `GENERIC_FOODS_VERSION` in `src/db/generic.ts`, così i telefoni già installati ricevono le voci nuove. Quelle che hai corretto a mano non vengono toccate.

Ogni voce del diario salva una copia dei propri valori, quindi correggere o eliminare un alimento non cambia i giorni passati.
