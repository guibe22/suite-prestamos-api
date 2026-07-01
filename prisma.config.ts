import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  // Specifies the location of your schema file
  schema: "prisma/schema.prisma",

  // Contains the connection URL for CLI/Migrate
  datasource: {
    url: env("DATABASE_URL"), // This uses the DATABASE_URL from your .env file
  },

  // Optional: For Prisma Migrate configuration
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
