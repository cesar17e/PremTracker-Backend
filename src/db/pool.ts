import { Pool } from "pg";
import dotenv from "dotenv";
import type { Server } from "node:http";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined");
}

const conn = process.env.DATABASE_URL!;               

export const pool = new Pool({
  connectionString: conn,                            
  ssl: conn.includes("sslmode=require")          
    ? { rejectUnauthorized: false }                    
    : undefined,                                     
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

let shuttingDown = false;

export const shutdown = async (message: string, exitCode = 0, server?: Server) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(message);
  const deadline = setTimeout(() => {
    console.error("Shutdown timed out. Forcing exit.");
    process.exit(1);
  }, 25_000);
  deadline.unref();

  try {
    // Drain active HTTP handlers before closing their database connections.
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await pool.end();
    console.log("PostgreSQL pool closed");
  } catch (err) {
    console.error("Error during shutdown:", err);
    exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.exit(exitCode);
  }
};
