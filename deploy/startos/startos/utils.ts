export const appPort = 3000
export const apiPort = 3001
export const agentPort = 2000

export const postgresDb = 'crm'
export const postgresUser = 'postgres'
export const postgresPort = 5432

export const appDir = '/app'
export const assetsDir = '/assets'

export const secretCharset = 'a-z,A-Z,0-9'

export const csvList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
