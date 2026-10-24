UPDATE "apikey"
SET "rateLimitEnabled" = true,
    "rateLimitTimeWindow" = 60000,
    "rateLimitMax" = 3000;
