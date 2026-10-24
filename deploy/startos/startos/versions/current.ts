import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.22.1:0',
  releaseNotes: {
    en_US:
      'The REST routes for the sales review queue, pending sales requests, company options and two field lists now reach the right endpoint. Calls under /rest need a CRM API key. The OpenAPI document at /openapi.json is public and lists only the paths the web interface serves. The sales page says when a request stops waiting, refreshes its review queue after each decision, and keeps the queue locked while a decision runs. A second rejection with another reason is refused. A request with an Upgrade header no longer fails with an API error.',
    es_ES:
      'Las rutas REST de la cola de revisión de ventas, las solicitudes de ventas pendientes, las opciones de empresa y dos listas de campos llegan ahora al punto final correcto. Las llamadas bajo /rest necesitan una clave de API del CRM. El documento OpenAPI en /openapi.json es público y solo lista las rutas que sirve la interfaz web. La página de ventas indica cuándo una solicitud deja de esperar, actualiza su cola de revisión después de cada decisión y bloquea la cola mientras una decisión está en curso. Se rechaza un segundo rechazo con otro motivo. Una solicitud con un encabezado Upgrade ya no falla con un error de la API.',
    de_DE:
      'Die REST-Routen für die Vertriebs-Prüfwarteschlange, offene Vertriebsanfragen, Firmenoptionen und zwei Feldlisten erreichen jetzt den richtigen Endpunkt. Aufrufe unter /rest brauchen einen CRM-API-Schlüssel. Das OpenAPI-Dokument unter /openapi.json ist öffentlich und listet nur die Pfade, die die Weboberfläche bereitstellt. Die Vertriebsseite meldet, wenn eine Anfrage nicht mehr wartet, aktualisiert ihre Prüfwarteschlange nach jeder Entscheidung und sperrt die Warteschlange, solange eine Entscheidung läuft. Eine zweite Ablehnung mit einer anderen Begründung wird abgewiesen. Eine Anfrage mit einem Upgrade-Header scheitert nicht mehr mit einem API-Fehler.',
    pl_PL:
      'Ścieżki REST kolejki przeglądu sprzedaży, oczekujących zapytań sprzedażowych, opcji firm i dwóch list pól trafiają teraz do właściwego punktu końcowego. Wywołania pod /rest wymagają klucza API CRM. Dokument OpenAPI pod /openapi.json jest publiczny i zawiera tylko ścieżki obsługiwane przez interfejs WWW. Strona sprzedaży informuje, kiedy zapytanie przestaje czekać, odświeża kolejkę przeglądu po każdej decyzji i blokuje kolejkę, gdy decyzja jest w toku. Drugie odrzucenie z innym powodem jest odrzucane. Zapytanie z nagłówkiem Upgrade nie kończy się już błędem API.',
    fr_FR:
      'Les routes REST de la file de revue commerciale, des demandes commerciales en attente, des options d’entreprise et de deux listes de champs atteignent maintenant le bon point de terminaison. Les appels sous /rest exigent une clé d’API du CRM. Le document OpenAPI à /openapi.json est public et ne liste que les chemins que l’interface web sert. La page commerciale indique quand une demande cesse d’attendre, actualise sa file de revue après chaque décision et verrouille la file pendant qu’une décision est en cours. Un second rejet avec un autre motif est refusé. Une requête avec un en-tête Upgrade n’échoue plus avec une erreur de l’API.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
