import { storeJson } from './fileModels/store.json'
import { sdk } from './sdk'
import { postgresDb, postgresUser } from './utils'

export const { createBackup, restoreInit } = sdk.setupBackups(async () =>
  sdk.Backups.withPgDump({
    imageId: 'postgres',
    dbVolume: 'main',
    mountpoint: '/var/lib/postgresql',
    pgdataPath: '/data',
    database: postgresDb,
    user: postgresUser,
    password: async () => {
      const password = await storeJson.read((s) => s.postgresPassword).once()
      if (!password) throw new Error('No postgres password in store.json')
      return password
    },
  }).addVolume('main', { options: { exclude: ['postgresql'], delete: true } }),
)
