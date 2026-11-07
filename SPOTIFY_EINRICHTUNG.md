# Spotify-App für die Klassik-Zeitreise einrichten

Dauer: ca. 10 Minuten, am besten am Computer (geht auch am Handy).
Du brauchst: deinen Spotify-Premium-Login. Kosten: keine.

Papa sieht davon nichts: Die „App“ ist nur ein Eintrag in deinem Spotify-Konto, der unserer
Spiel-Webseite erlaubt, auf deinem Handy Musik abzuspielen.

## 1. Anmelden

1. Öffne **https://developer.spotify.com/dashboard**
2. Melde dich mit deinem normalen Spotify-Konto an.
3. Beim ersten Mal fragt Spotify nach den „Developer Terms“: lesen, Haken setzen, akzeptieren.
   Falls Spotify eine E-Mail-Bestätigung verlangt: Mail öffnen, Link klicken, zurück zum
   Dashboard.

## 2. App erstellen

Klicke auf **„Create app“** und fülle aus:

| Feld | Eintrag |
|---|---|
| App name | `Klassik-Zeitreise` |
| App description | `Privates Familienspiel` |
| Website | leer lassen |
| Redirect URIs | die zwei Adressen unten, **jede einzeln** einfügen und auf **„Add“** klicken |
| Which API/SDKs are you planning to use? | Haken bei **„Web API“** |

Redirect URIs, genau so abtippen bzw. kopieren (inklusive `/` am Ende):

```
https://olivier-schroeder.github.io/klassik-zeitreise/
```
```
http://127.0.0.1:8765/
```

Dann den Haken bei den Nutzungsbedingungen setzen und **„Save“** klicken.

## 3. Client ID an Olivier schicken

1. Du landest auf der Seite der neuen App (sonst im Dashboard auf „Klassik-Zeitreise“ klicken).
2. Oben rechts **„Settings“** → Reiter **„Basic Information“**.
3. Dort steht die **Client ID** (eine lange Folge aus Buchstaben und Zahlen). Kopieren und
   Olivier schicken. Die ist nicht geheim.
4. ⚠️ **Nicht** auf „View client secret“ klicken und das Secret **nicht** verschicken: wir
   brauchen es nicht.

## 4. Mitspieler freischalten

Die App ist im „Development mode“. Darin dürfen sich nur Konten anmelden, die du
freischaltest. **Dein eigenes Konto ist automatisch freigeschaltet.**

Freischalten musst du alle anderen, die das Spiel mit **ihrem eigenen** Spotify auf ihrem
Handy spielen wollen, mindestens **Olivier** (zum Testen):

1. In den Settings den Reiter **„User Management“** öffnen.
2. Name und **die E-Mail-Adresse ihres Spotify-Kontos** eintragen → **„Add user“**.
3. Für jede Person wiederholen.

Wer nicht freigeschaltet ist, bekommt im Spiel „Spotify hat die Wiedergabe abgelehnt“.

## Wenn etwas nicht passt

- Eine Redirect URI fehlt oder ist falsch: Settings → unten **„Edit“** → korrigieren →
  „Save“. Das kann man jederzeit ändern.
- Die App bitte nicht löschen: sonst gibt es eine neue Client ID und Olivier muss sie neu
  eintragen. Die gedruckten Karten funktionieren aber weiter.
