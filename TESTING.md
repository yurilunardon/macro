# Prova sull'iPhone

Lista di controlli per la prima prova, da fare prima in **Expo Go** e poi con l'app installata da AltStore. Se qualcosa non va, annota la schermata, cosa hai toccato e cosa ti aspettavi: uno screenshot aiuta molto.

## Avvio

- [ ] L'app si apre sul **Diario** di oggi, con tre tab in basso: Diario, Progressi e Profilo.
- [ ] Il banner "Imposta i tuoi obiettivi" è visibile.
- [ ] Il **tema scuro** funziona: cambialo dal Centro di Controllo e controlla che testi e anelli restino leggibili.

## Scanner

- [ ] Icona del codice a barre in alto a destra nel Diario → viene chiesto il permesso alla fotocamera, in italiano.
- [ ] Scansiona 3 prodotti diversi, per esempio una pasta, uno yogurt e una bibita. Si apre la scheda con nome, marca e foto.
- [ ] La **torcia** si accende e si spegne.
- [ ] "Inserisci il codice a mano" (icona tastiera) funziona.
- [ ] Un prodotto che non c'è porta a "Prodotto non trovato" → **Crea alimento**, con il codice già compilato. Salvalo, poi riscansionalo: deve aprirsi subito, senza cercarlo online.

## Ricerca e alimenti base

- [ ] "Aggiungi" su un pasto → scheda **Base** → apri "Frutta" → scegli **Mela**: il pulsante dice "1 mela media · 180 g".
- [ ] Cerca **caffe** senza accento: trova "Caffè espresso".
- [ ] Cerca **petto di pollo**: in cima c'è "Petto di pollo, crudo".
- [ ] Cerca una marca e premi **Cerca** sulla tastiera: arrivano i risultati di Open Food Facts.
- [ ] Senza connessione (modalità aereo), la ricerca online mostra un messaggio d'errore e non si blocca.

## Diario

- [ ] Nella scheda prodotto cambia i grammi: calorie e macro si aggiornano mentre scrivi.
- [ ] Il tastierino numerico ha il pulsante **Fine** sopra, che chiude la tastiera.
- [ ] Il pulsante "Aggiungi a…" resta raggiungibile con la tastiera aperta.
- [ ] Dopo "Aggiungi" il modale si chiude e la voce compare nel pasto giusto; anello e barre si aggiornano.
- [ ] Toccando una voce si modifica quantità o pasto; tenendo premuto compare il menu con "Elimina".
- [ ] **Aggiunta rapida**: solo 500 kcal → compare nel pasto. Poi riaprila e modificala.
- [ ] Passa a **ieri** con la freccia, aggiungi qualcosa a colazione, torna a oggi: compare **Copia da ieri** e funziona.
- [ ] **Acqua**: + e − cambiano i litri e la barra.
- [ ] Toccando il titolo del giorno si torna a "Oggi".

## Obiettivi e progressi

- [ ] Profilo → Calorie e macro → compila i tuoi dati → **Calcola** → **Salva obiettivi**. Il banner del Diario sparisce.
- [ ] Progressi → **Registra il peso** → compare nel grafico e nella lista. Tenendo premuto una pesata la elimini.
- [ ] Il grafico "Ultimi 7 giorni" mostra le calorie registrate.

## Dati e backup (il più importante)

- [ ] Chiudi l'app del tutto (scorri via dal multitasking) e riaprila: è tutto ancora lì.
- [ ] Profilo → **Esporta backup** → "Salva su File" → iCloud Drive. Il file `macro-backup-AAAA-MM-GG.json` c'è.
- [ ] Profilo → **Ripristina da un backup** → scegli quel file → compare il riepilogo → conferma → i dati coincidono.
- [ ] Il giorno dopo, riaprendo l'app che era rimasta aperta, il Diario mostra **Oggi** e non "Ieri".

## Con AltStore

- [ ] `npm run build:ipa` sul Mac produce `build/Macro.ipa`. Se fallisce, conserva `build/xcodebuild.log`.
- [ ] Installata con AltStore, l'app si apre e ha l'icona verde ad anello.
- [ ] Registra qualcosa, poi **AltStore → Refresh All**: i dati restano.
- [ ] Installa un IPA nuovo sopra quello vecchio, con lo stesso Apple ID: i dati restano.
