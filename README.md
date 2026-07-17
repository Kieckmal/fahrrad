# Fahrrad Deal Tracker

Dashboard und automatischer Scanner für Gravel-/Cyclocross-Angebote in Rahmengröße **60 cm** bzw. passenden Herstellergrößen.

## Enthaltene Quellen
Buycycle, BikeExchange, BikeFlip, **Rebike**, **Bike2Future**, Stevens-Händler, ROSE, Canyon, Trek- und Ridley-Händler. Kleinanzeigen ist bewusst ausgeschlossen.

## Modelle
Stevens Vapor 2x12, Rose Backroad AL, Canyon Grail AL, Ridley Kanzo A, Trek Checkpoint ALR 5 sowie BMC URS AL, Orbea Terra H30, Scott Speedster Gravel und Focus Atlas.

## Start
```bash
npm install
npx playwright install chromium
npm run scan
npm run serve
```

## GitHub Pages
In den Repository-Einstellungen unter **Pages** als Quelle `main /public` wählen. Alternativ kann das Verzeichnis `public` über einen separaten Deployment-Workflow veröffentlicht werden.

## Hinweise zu Scannern
Händlerseiten ändern regelmäßig HTML-Struktur, Suchparameter und Bot-Schutz. Die derzeitige generische Erkennung ist eine belastbare Grundstruktur, aber einzelne Quellen benötigen nach dem ersten Testlauf möglicherweise spezifische Adapter. Nutzungsbedingungen und robots.txt der jeweiligen Plattform sind zu beachten.
