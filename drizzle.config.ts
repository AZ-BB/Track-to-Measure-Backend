import * as dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import path from 'path';

// Clear any existing env variables
for (const key in process.env) {
    if (key.startsWith('DATABASE_')) {
        delete process.env[key];
    }
}

// Load dev environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export default defineConfig({
    out: './drizzle',
    schema: './src/db/schema.ts',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL!
    }
}); 