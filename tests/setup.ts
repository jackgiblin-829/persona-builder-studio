import { config as loadEnv } from "../src/lib/dotenv";

loadEnv();
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
