import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.21.0:0',
  releaseNotes: {
    en_US:
      'The CRM is now Freehold AI CRM. Sales proposals have a review queue, and a person can reject a proposal with a reason. Each deal board column shows its value in the reporting currency. The REST API and its OpenAPI document are reachable on the web interface at /rest and /openapi.json, with an API key. Start is faster on large media folders, because only files with the wrong owner are changed. Existing data is migrated on start.',
    es_ES:
      'El CRM ahora es Freehold AI CRM. Las propuestas de ventas tienen una cola de revisión, y una persona puede rechazar una propuesta con un motivo. Cada columna del tablero de oportunidades muestra su valor en la moneda de informes. La API REST y su documento OpenAPI están disponibles en la interfaz web, en /rest y /openapi.json, con una clave de API. El inicio es más rápido con carpetas de medios grandes, porque solo se cambian los archivos con el propietario incorrecto. Los datos existentes se migran al iniciar.',
    de_DE:
      'Das CRM heißt jetzt Freehold AI CRM. Vertriebsvorschläge haben eine Prüfwarteschlange, und eine Person kann einen Vorschlag mit Begründung ablehnen. Jede Spalte des Deal-Boards zeigt ihren Wert in der Berichtswährung. Die REST-API und ihr OpenAPI-Dokument sind über die Weboberfläche unter /rest und /openapi.json mit einem API-Schlüssel erreichbar. Der Start ist bei großen Medienordnern schneller, weil nur Dateien mit falschem Eigentümer geändert werden. Vorhandene Daten werden beim Start migriert.',
    pl_PL:
      'CRM nazywa się teraz Freehold AI CRM. Propozycje sprzedażowe mają kolejkę do przeglądu, a osoba może odrzucić propozycję z podaniem powodu. Każda kolumna tablicy transakcji pokazuje swoją wartość w walucie raportowania. REST API i jego dokument OpenAPI są dostępne w interfejsie WWW pod /rest i /openapi.json, z kluczem API. Uruchamianie jest szybsze przy dużych folderach multimediów, ponieważ zmieniane są tylko pliki z niewłaściwym właścicielem. Istniejące dane są migrowane przy uruchomieniu.',
    fr_FR:
      'Le CRM s’appelle désormais Freehold AI CRM. Les propositions commerciales ont une file de revue, et une personne peut rejeter une proposition avec un motif. Chaque colonne du tableau des affaires affiche sa valeur dans la devise de reporting. L’API REST et son document OpenAPI sont accessibles sur l’interface web, à /rest et /openapi.json, avec une clé d’API. Le démarrage est plus rapide avec de grands dossiers de médias, car seuls les fichiers dont le propriétaire est incorrect sont modifiés. Les données existantes sont migrées au démarrage.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
