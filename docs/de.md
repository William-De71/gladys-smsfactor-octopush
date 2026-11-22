# SMSFactor + Octopush

## Überblick

Diese Integration sendet die Benachrichtigungen von Gladys per SMS über eines
von zwei französischen SMS-Gateways, [SMSFactor](https://www.smsfactor.com)
oder [Octopush](https://www.octopush.com), an jede Mobilnummer und jeden
Anbieter. Jede Person, die Gladys nutzt, gibt ihre eigene Mobilnummer ein; die
Administration wählt den Anbieter und gibt seine Zugangsdaten einmal für das
ganze Haus ein.

Außerdem bringt sie:

- vier **Szenenauslöser**: SMS nicht gesendet, SMS nicht zugestellt, SMS
  empfangen, wenig Guthaben;
- zwei **Szenenaktionen**: eine SMS an eine beliebige Nummer senden (auch an
  jemanden ohne Gladys-Konto), das SMS-Konto lesen;
- zwei **Dashboard-Widgets**: das SMS-Konto und die SMS-Antworten.

![Die zwei Widgets der Integration: das SMS-Konto mit seinem Guthaben und die letzten empfangenen Antworten (generierte Illustration, kein Screenshot)](https://raw.githubusercontent.com/William-De71/gladys-smsfactor-octopush/main/docs/assets/widgets.de.png)

|                                   | SMSFactor               | Octopush              |
| --------------------------------- | ----------------------- | --------------------- |
| Senden, Szenenaktionen            | Ja                      | Ja                    |
| Wenig Guthaben                    | In SMS-Guthaben         | In Euro (Saldo)       |
| SMS nicht zugestellt (Berichte)   | Ja, alle 5 Min. gelesen | Nein (nur Callbacks)  |
| Antworten (SMS empfangen, Widget) | Ja, jede Minute gelesen | Nein (nur Callbacks)  |
| Liste der Absender                | Ja                      | Nein                  |
| SMS-Typ                           | Einer                   | Premium oder Low Cost |

Octopush meldet Zustellungen und Antworten nur an eine öffentliche Webadresse,
die ein Gladys zu Hause nicht hat: Mit Octopush sendet die Integration nur.

Transport: **Cloud**. Die Texte und Rufnummern laufen über die API des
Anbieters (`api.smsfactor.com` oder `api.octopush.com`) und dann über die
Mobilfunkbetreiber.

## Voraussetzungen

- Gladys Assistant **5.3.0** oder neuer.
- Ein Konto bei **SMSFactor** oder **Octopush** mit etwas Guthaben. Jede SMS
  verbraucht Guthaben, mehr für einen langen Text, ein Emoji oder eine
  ausländische Nummer.
- SMSFactor: ein **API-Token** (Entwickler → API-Tokens in Ihrem Konto).
- Octopush: der **Login** (E-Mail-Adresse) und der **API-Schlüssel** des
  Kontos sowie ein von Octopush **freigeschaltetes** Konto (Registrierung
  abgeschlossen).
- Optional: ein **Absendername** (3 bis 11 Buchstaben oder Ziffern, etwa
  `GLADYS`). Manche Länder verlangen, dass er zuerst registriert wird. Auf
  einen Namensabsender kann man nicht antworten.

## Konfiguration

1. Öffnen Sie in Gladys **Integrationen → SMSFactor + Octopush →
   Konfiguration**.
2. Wählen Sie den **Anbieter**.
3. Tragen Sie nur die Zugangsdaten dieses Anbieters ein: das **SMSFactor-API-
   Token** oder den **Octopush-Login** und **API-Schlüssel** (und seinen
   SMS-Typ). Speichern Sie.
4. Klicken Sie auf **Verbindung testen**: Sie zeigt Guthaben oder Saldo und
   bei SMSFactor die Absender. **Test-SMS senden** prüft die ganze Kette.
5. Jede Person öffnet den Block **Mein Konto** auf derselben Seite und gibt
   ihre **Mobilnummer** ein.

| Feld                        | Zweck                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| Anbieter                    | SMSFactor oder Octopush                                                                        |
| SMSFactor-API-Token         | Aus Entwickler → API-Tokens, verschlüsselt gespeichert                                         |
| Octopush-Login              | Die E-Mail-Adresse des Octopush-Kontos                                                         |
| Octopush-API-Schlüssel      | Aus dem API-Bereich der Octopush-Website, verschlüsselt gespeichert                            |
| Octopush-SMS-Typ            | Premium (schnell, eigener Absender, alle Länder) oder Low Cost (nur Frankreich, günstiger)     |
| Absender                    | Optional: 3 bis 11 Buchstaben oder Ziffern; leer = Standard des Kontos                         |
| Standard-Ländervorwahl      | Wird Nummern ohne Vorwahl vorangestellt (`33` standardmäßig: 06… wird zu +336…)                |
| Warnung bei wenig Guthaben  | Unter diesem Betrag löst „Wenig Guthaben“ einmal aus (leer: 20 Guthaben oder 2 € bei Octopush) |
| Antworten lesen (SMSFactor) | Liest die Antworten jede Minute, für „SMS empfangen“ und das Antworten-Widget                  |

Die SMS gehen als **Warnungen** (transaktional) hinaus, nicht als Werbung: Sie
werden zu jeder Uhrzeit gesendet, ohne „STOP“-Hinweis. Nutzen Sie die
Integration nur für die Benachrichtigungen Ihres Hauses.

## Verwendung

### Benachrichtigungen

Jede Gladys-Benachrichtigung an eine Person, die eine Nummer eingegeben hat,
geht per SMS hinaus: Alarme, Szenenaktionen „Nachricht senden“, Antworten von
Gladys. Ein angehängtes Bild wird verworfen (eine SMS transportiert nur Text).
Ein Text mit einem Zeichen außerhalb des SMS-Alphabets (ein Emoji, „ê“, „œ“)
wird als Unicode gesendet, also 70 statt 160 Zeichen pro SMS.

### Szenenauslöser

| Auslöser             | Wann er auslöst                                                                                            | Variablen                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| SMS nicht gesendet   | Beim ersten Fehler einer Benachrichtigung, danach erst wieder, nachdem eine SMS durchging (keine Schleife) | Ursache, HTTP-Status, Fehler, maskierte Nummer |
| SMS nicht zugestellt | SMSFactor hat eine SMS angenommen, meldet aber, dass sie nie ankam (48 Stunden nach dem Senden gelesen)    | maskierte Nummer, Status, Details, Ticket      |
| SMS empfangen        | Jede neue Antwort auf dem SMSFactor-Konto, gefiltert nach Absender und erstem Wort („Antworten lesen“)     | Absender, Text, erstes Wort, Datum             |
| Wenig Guthaben       | Guthaben oder Saldo ist unter die Schwelle gefallen; erst wieder nach einer Aufladung darüber              | Restbetrag, Schwelle, Einheit, Anbieter        |

Antworten kommen nur für SMS, die **ohne eigenen Absender** gesendet wurden,
und nur in den Ländern, in denen SMSFactor sie erlaubt (Frankreich, Belgien,
Schweiz). **Nutzen Sie „SMS empfangen“ nie, um eine Tür zu öffnen oder eine
Alarmanlage zu entschärfen**: Jeder kann eine SMS mit gefälschter Nummer
senden.

### Szenenaktionen

- **SMS an eine Nummer senden**: eine oder mehrere Nummern, durch Kommas
  getrennt, und ein Text (Szenenvariablen erlaubt). Gibt die gesendeten SMS,
  die nicht erkannten Nummern, die vom Anbieter gefilterten Nummern sowie das
  verbrauchte und verbleibende Guthaben zurück.
- **SMS-Konto lesen**: gibt Guthaben oder Saldo mit Einheit zurück, die in
  diesem Monat gesendeten, empfangenen und nicht zugestellten SMS und den
  Anbieter.

### Szenenbeispiele

- _Wenn der Alarm auslöst_ → eine SMS an den Nachbarn senden: „Alarm bei uns,
  kannst du nachsehen?“.
- _Wenn das Guthaben knapp wird_ → der Administration eine Nachricht senden:
  „Nur noch {{triggerEvent.data.credits_left}} auf dem SMS-Konto“.
- _Wenn eine SMS nicht zugestellt wird_ → die Warnung über einen anderen Kanal
  erneut senden (Telegram, E-Mail).

### Dashboard-Widgets

- **SMS-Konto**: Guthaben oder Saldo (orange nahe der Schwelle, rot darunter),
  der Zustand der API, die in diesem Monat gesendeten, empfangenen und nicht
  zugestellten SMS, der Absender, die Schwelle und der letzte Fehler.
- **SMS-Antworten**: die letzten empfangenen Antworten (SMSFactor); tippen Sie
  auf eine, um sie ganz zu lesen.

## Fehlerbehebung

- **„lehnt die Zugangsdaten ab“**: Das SMSFactor-Token wurde gelöscht oder der
  Octopush-API-Schlüssel neu erzeugt: Übernehmen Sie den aktuellen.
- **„noch nicht freigeschaltet“** (Octopush): Schließen Sie die Registrierung
  auf der Octopush-Website ab.
- **„Absender abgelehnt“**: Der Absender ist nicht registriert oder für dieses
  Land nicht erlaubt: Leeren Sie das Feld, um den Standard des Kontos zu
  nutzen.
- **„Land nicht erlaubt“**: SMSFactor braucht eine Freigabe, um in ein anderes
  Land als das des Kontos zu senden.
- **„Nummer gesperrt (STOP)“**: Der Empfänger hat einmal mit STOP geantwortet,
  oder die Nummer gilt als unerreichbar.
- **Keine Antwort empfangen**: Antworten brauchen SMSFactor, eine ohne eigenen
  Absender gesendete SMS und „Antworten lesen“.
- **Protokolle**: Integrationen → SMSFactor + Octopush → Reiter Überwachung.
  Rufnummern sind maskiert; Token und Schlüssel erscheinen nie.
