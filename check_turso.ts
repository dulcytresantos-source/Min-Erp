
import { createClient } from "@libsql/client";
import dotenv from "dotenv";
dotenv.config();

async function check() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  console.log("Checking Turso DB...");
  console.log("URL:", url ? "Configured" : "MISSING");
  console.log("Token:", token ? "Configured" : "MISSING");

  if (!url || !token) {
    console.error("Missing Turso credentials in .env");
    return;
  }

  const client = createClient({ url, authToken: token });

  try {
    const companies = await client.execute("SELECT * FROM companies");
    console.log("Companies found:", companies.rows.length);
    if (companies.rows.length > 0) {
      console.log("First company:", companies.rows[0].name);
    }

    const suppliers = await client.execute("SELECT COUNT(*) as count FROM suppliers");
    console.log("Suppliers count:", suppliers.rows[0].count);

    const invoices = await client.execute("SELECT COUNT(*) as count FROM invoices");
    console.log("Invoices count:", invoices.rows[0].count);

  } catch (err) {
    console.error("Error checking Turso:", err);
  }
}

check();
