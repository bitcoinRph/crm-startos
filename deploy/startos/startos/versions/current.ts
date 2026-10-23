import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.19.0:0',
  releaseNotes: {
    en_US:
      'Customer lookup returns verified records and identifies ambiguous matches. Follow-ups preserve customer evidence and approval requirements. The package uses the official Freehold icon.',
    es_ES:
      'La búsqueda de clientes devuelve registros verificados e identifica coincidencias ambiguas. Los seguimientos conservan las pruebas del cliente y los requisitos de aprobación. El paquete usa el icono oficial de Freehold.',
    de_DE:
      'Die Kundensuche liefert verifizierte Datensätze und erkennt mehrdeutige Treffer. Folgeaufgaben bewahren Kundennachweise und Genehmigungsanforderungen. Das Paket verwendet das offizielle Freehold-Symbol.',
    pl_PL:
      'Wyszukiwanie klientów zwraca zweryfikowane rekordy i wskazuje niejednoznaczne dopasowania. Dalsze działania zachowują dowody dotyczące klienta i wymagania zatwierdzenia. Pakiet używa oficjalnej ikony Freehold.',
    fr_FR:
      'La recherche de clients renvoie des fiches vérifiées et signale les correspondances ambiguës. Les suivis conservent les preuves concernant le client et les exigences d’approbation. Le paquet utilise l’icône officielle de Freehold.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
