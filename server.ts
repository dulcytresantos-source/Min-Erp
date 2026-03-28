console.log("Server starting (V6.28 - Vercel Optimized Initialization)...");
if (process.env.VERCEL) console.log("Running in VERCEL environment");

import express from "express";
import path from "path";
import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

// Helper to mask sensitive strings
function maskString(str: string | undefined) {
  if (!str) return "MISSING";
  if (str.length < 10) return "***";
  return str.substring(0, 4) + "..." + str.substring(str.length - 4);
}

export const app = express();
const PORT = 3000;

// Lazy AI Client
let aiClient: any = null;
const getAI = () => {
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "missing-key" });
  }
  return aiClient;
};

// Turso Database Client
let dbClient: any = null;
const getDb = () => {
  if (dbClient) return dbClient;

  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      console.error("CRITICAL: TURSO_DATABASE_URL is missing in production!");
      dbClient = {
        execute: async (args: any) => { throw new Error("TURSO_DATABASE_URL is not configured. Please check your environment variables."); },
        batch: async (args: any) => { throw new Error("TURSO_DATABASE_URL is not configured."); }
      };
      return dbClient;
    }
    dbClient = createClient({ url: "file:local.db" });
    return dbClient;
  }

  try {
    dbClient = createClient({
      url: url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    return dbClient;
  } catch (e) {
    console.error("Failed to create database client:", e);
    dbClient = {
      execute: async (args: any) => { throw new Error(`Failed to initialize DB client: ${(e as Error).message}`); },
      batch: async (args: any) => { throw new Error("Failed to initialize DB client."); }
    };
    return dbClient;
  }
};

// Turso Database Client Proxy
const db = {
  execute: (args: any) => getDb().execute(args),
  batch: (args: any, mode?: any) => getDb().batch(args, mode),
};

// Mask the URL for logging
const getMaskedUrl = () => {
  const url = process.env.TURSO_DATABASE_URL || (process.env.NODE_ENV === "production" ? "MISSING" : "file:local.db");
  if (url.startsWith("libsql://")) {
    return url.substring(0, 15) + "..." + (url.length > 10 ? url.substring(url.length - 10) : "");
  }
  return url;
};

console.log(`Database URL Status: ${getMaskedUrl()}`);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// DEBUG ROUTES (Must be before DB initialization middleware to allow diagnosis)
app.get("/api/debug/ping", (req, res) => {
  res.json({ status: "ok", message: "pong", timestamp: new Date().toISOString(), version: "V6.28" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), env: process.env.NODE_ENV, version: "V6.28" });
});

app.get("/api/debug/config", (req, res) => {
  res.json({
    version: "V6.28",
    node_version: process.version,
    env: {
      TURSO_URL: maskString(process.env.TURSO_DATABASE_URL),
      TURSO_TOKEN: maskString(process.env.TURSO_AUTH_TOKEN),
      GEMINI_KEY: maskString(process.env.GEMINI_API_KEY),
      VERCEL: process.env.VERCEL || "false"
    }
  });
});

app.get("/api/debug/env-check", (req, res) => {
  res.json({
    TURSO_DATABASE_URL: maskString(process.env.TURSO_DATABASE_URL),
    TURSO_AUTH_TOKEN: maskString(process.env.TURSO_AUTH_TOKEN),
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL
  });
});

app.get("/api/debug/raw-conn", async (req, res) => {
  try {
    const db = getDb();
    const start = Date.now();
    const result = await db.execute("SELECT 1 as connected");
    const end = Date.now();
    res.json({ 
      status: "ok", 
      message: "Raw Connection OK", 
      latency: `${end - start}ms`,
      data: result.rows[0] 
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: (err as Error).message });
  }
});

app.get("/api/debug-env", (req, res) => {
  res.json({
    TURSO_DATABASE_URL: maskString(process.env.TURSO_DATABASE_URL),
    TURSO_AUTH_TOKEN: maskString(process.env.TURSO_AUTH_TOKEN),
    GEMINI_API_KEY: maskString(process.env.GEMINI_API_KEY),
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV
  });
});

app.get("/api/debug-db", async (req, res) => {
  try {
    const dbUrl = process.env.TURSO_DATABASE_URL || "file:local.db";
    const isLocal = dbUrl === "file:local.db";
    
    // Attempt a simple query to check connection
    let count = 0;
    try {
      const db = getDb();
      const result = await db.execute("SELECT COUNT(*) as count FROM companies");
      count = result.rows[0].count as number;
    } catch (e) {
      return res.status(500).json({
        status: "error",
        message: `Database Connection/Query Failed: ${(e as Error).message}`,
        database: isLocal ? "LOCAL (EPHEMERAL)" : "REMOTE (TURSO)",
        db_initialized: dbInitialized,
        init_error: dbInitError,
        url_configured: !!process.env.TURSO_DATABASE_URL,
        token_configured: !!process.env.TURSO_AUTH_TOKEN
      });
    }
    
    // Mask the URL for security
    const maskedUrl = dbUrl.startsWith("libsql://") 
      ? dbUrl.substring(0, 15) + "..." + (dbUrl.length > 10 ? dbUrl.substring(dbUrl.length - 10) : "")
      : dbUrl;

    res.json({
      status: "ok",
      database: isLocal ? "LOCAL (EPHEMERAL)" : "REMOTE (TURSO)",
      url: maskedUrl,
      url_configured: !!process.env.TURSO_DATABASE_URL,
      token_configured: !!process.env.TURSO_AUTH_TOKEN,
      db_initialized: dbInitialized,
      init_error: dbInitError,
      companies_count: count,
      message: isLocal ? "WARNING: Using local database. Data will be lost on restart." : "Connected to remote database."
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: (error as Error).message,
      db_initialized: dbInitialized,
      init_error: dbInitError
    });
  }
});

// Database initialization state
let dbInitialized = false;
let dbInitPromise: Promise<void> | null = null;
let dbInitError: string | null = null;

// Initialize Database (Optimized with Batch for Vercel)
async function initDb() {
  const db = getDb();
  try {
    console.log(`Initializing database schema (${getMaskedUrl()})...`);
    dbInitError = null;
    
    // Group all schema operations into a single batch to avoid multiple network roundtrips
    await db.batch([
      // 1. Tables
      `CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT,
        cif TEXT,
        is_default INTEGER DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        company_id INTEGER,
        name TEXT NOT NULL,
        cif TEXT NOT NULL,
        alias TEXT,
        name2 TEXT,
        address TEXT,
        address2 TEXT,
        zip_code TEXT,
        city TEXT,
        province TEXT,
        country_code TEXT,
        phone TEXT,
        email TEXT,
        main_contact TEXT,
        is_generic INTEGER DEFAULT 0,
        FOREIGN KEY (company_id) REFERENCES companies (id)
      )`,
      `CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER,
        supplier_id TEXT NOT NULL,
        doc_id TEXT,
        doc_ext TEXT,
        invoice_number TEXT,
        issue_date TEXT,
        due_date TEXT,
        tax_base REAL DEFAULT 0,
        vat REAL DEFAULT 0,
        total_amount REAL NOT NULL,
        status TEXT DEFAULT 'Pending',
        concept TEXT,
        FOREIGN KEY (company_id) REFERENCES companies (id),
        FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
      )`,
      `CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        payment_date TEXT,
        amount_paid REAL NOT NULL,
        method TEXT,
        bank_movement_id TEXT,
        FOREIGN KEY (invoice_id) REFERENCES invoices (id)
      )`,
      // 2. Indexes
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_company_cif ON suppliers (company_id, cif)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_unique ON invoices (company_id, supplier_id, doc_ext)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_unique_num ON invoices (company_id, supplier_id, invoice_number)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_doc_id ON invoices (company_id, doc_id)`
    ], "write");

    // Check if we need a default company (Single query)
    const companyCountResult = await db.execute("SELECT COUNT(*) as count FROM companies");
    if (Number(companyCountResult.rows[0].count) === 0) {
      await db.execute({
        sql: "INSERT INTO companies (name, address, cif, is_default) VALUES (?, ?, ?, ?)",
        args: ["MI EMPRESA S.L.", "CALLE MAYOR 1, MADRID", "B12345678", 1]
      });
    }

    console.log("Database schema initialized successfully");
    dbInitialized = true;
  } catch (err) {
    dbInitError = (err as Error).message;
    console.error("Database initialization failed:", err);
    dbInitialized = true;
  }
}

// Seed Demo Data (Optimized with Batch)
async function seedDemoData() {
  const db = getDb();
  
  // 1. Ensure we have a company
  let companyId: number;
  const companyResult = await db.execute("SELECT id FROM companies WHERE name = 'EMPRESA DEMO S.L.' LIMIT 1");
  
  if (companyResult.rows.length === 0) {
    const res = await db.execute({
      sql: "INSERT INTO companies (name, address, cif, is_default) VALUES (?, ?, ?, ?)",
      args: ["EMPRESA DEMO S.L.", "AVENIDA DE LAS DEMOS 123", "B99999999", 0]
    });
    companyId = Number(res.lastInsertRowid);
  } else {
    companyId = Number(companyResult.rows[0].id);
  }

  const seedSuppliers = [
    { id: 'PRov001', name: 'Coca-Cola European Partners', cif: 'A86561712', email: 'billing@cocacola.com', address: 'Calle de la Ribera del Loira, 20', city: 'Madrid', province: 'Madrid', zip_code: '28042', country_code: 'ES', alias: 'COCACOLA', phone: '913345000' },
    { id: 'PRov002', name: 'IBM España S.A.', cif: 'A28010644', email: 'invoices@es.ibm.com', address: 'Calle de Santa Hortensia, 26', city: 'Madrid', province: 'Madrid', zip_code: '28002', country_code: 'ES', alias: 'IBM', phone: '913976000' },
    { id: 'PRov003', name: 'Telefónica S.A.', cif: 'A28015865', email: 'proveedores@telefonica.com', address: 'Gran Vía, 28', city: 'Madrid', province: 'Madrid', zip_code: '28013', country_code: 'ES', alias: 'TELEFONICA', phone: '915840306' },
    { id: 'PRov004', name: 'Inditex S.A.', cif: 'A15075062', email: 'finance@inditex.com', address: 'Avenida de la Diputación', city: 'Arteixo', province: 'A Coruña', zip_code: '15143', country_code: 'ES', alias: 'INDITEX', phone: '981185400' },
    { id: 'PRov005', name: 'Banco Santander S.A.', cif: 'A39000013', email: 'pagos@santander.com', address: 'Paseo de Pereda, 9-12', city: 'Santander', province: 'Cantabria', zip_code: '39004', country_code: 'ES', alias: 'SANTANDER', phone: '942206100' }
  ];

  const batchOps: any[] = [];

  for (const s of seedSuppliers) {
    const newId = `${companyId}-${s.id}`;
    batchOps.push({
      sql: "INSERT OR IGNORE INTO suppliers (id, company_id, name, cif, email, address, city, province, zip_code, country_code, alias, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [newId, companyId, s.name, s.cif, s.email, s.address, s.city, s.province, s.zip_code, s.country_code, s.alias, s.phone]
    });
  }

  // Seed Invoices & Payments (Demo Movements 2026)
  const suppliers = ['PRov001', 'PRov002', 'PRov003', 'PRov004', 'PRov005'];
  const statuses = ['Paid', 'Partial', 'Pending'];
  
  for (const sId of suppliers) {
    const fullSId = `${companyId}-${sId}`;
    const count = sId === 'PRov001' ? 8 : 3; // Reduced count for faster seeding
    const alias = seedSuppliers.find(s => s.id === sId)?.alias || 'SUP';
    
    for (let i = 1; i <= count; i++) {
      const month = Math.floor((i - 1) / (count / 12)) + 1;
      const day = (i * 3) % 28 + 1;
      const dateStr = `2026-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      const dueDate = `2026-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      
      const status = statuses[i % 3];
      const base = 100 * i + (Math.random() * 50);
      const total = base * 1.21;
      const invNum = `DEMO-26-${alias}-${i.toString().padStart(3, '0')}`;

      batchOps.push({
        sql: "INSERT OR IGNORE INTO invoices (company_id, supplier_id, doc_id, doc_ext, invoice_number, issue_date, due_date, tax_base, vat, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [companyId, fullSId, invNum, invNum, invNum, dateStr, dueDate, base, base * 0.21, total, status]
      });
    }
  }

  if (batchOps.length > 0) {
    console.log(`Executing batch of ${batchOps.length} demo operations...`);
    await db.batch(batchOps, "write");
  }

  console.log("Demo data seeded successfully");
}

// Middleware to log requests (Minimal & Fast)
app.use((req, res, next) => {
  if (process.env.VERCEL) {
    console.log(`[${req.method}] ${req.path}`);
  }
  next();
});

// API Routes
app.get("/api/admin/setup-db", async (req, res) => {
  try {
    console.log("Manual Setup Triggered...");
    await initDb();
    res.json({ 
      status: "ok", 
      message: "Estructura de base de datos verificada/creada correctamente. No se han borrado datos existentes.",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ 
      status: "error", 
      message: (err as Error).message 
    });
  }
});

app.get("/api/admin/seed-demo", async (req, res) => {
  try {
    console.log("Demo Seeding Triggered...");
    await seedDemoData();
    res.json({ 
      status: "ok", 
      message: "Empresa de demostración creada con éxito con movimientos para 2026.",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ 
      status: "error", 
      message: (err as Error).message 
    });
  }
});

app.get("/api/companies", async (req, res) => {
  // PRUEBA BRUTA DE BYPASS: Usamos un cliente fresco directo (como en debug-raw)
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url || !token) {
    return res.status(500).json({ error: "Missing TURSO credentials in bypass test" });
  }

  try {
    const tempDb = createClient({ url, authToken: token });
    const result = await tempDb.execute("SELECT * FROM companies ORDER BY name ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ 
      error: (err as Error).message,
      phase: "bypass-test-error"
    });
  }
});

app.post("/api/companies", async (req, res) => {
  const { name, address, cif } = req.body;
  try {
    const result = await db.execute({
      sql: "INSERT INTO companies (name, address, cif) VALUES (?, ?, ?)",
      args: [name ?? null, address ?? null, cif ?? null],
    });
    res.json({ id: Number(result.lastInsertRowid) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put("/api/companies/:id", async (req, res) => {
  const { name, address, cif } = req.body;
  try {
    await db.execute({
      sql: "UPDATE companies SET name = ?, address = ?, cif = ? WHERE id = ?",
      args: [name ?? null, address ?? null, cif ?? null, req.params.id ?? null],
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete("/api/companies/:id", async (req, res) => {
  const { id } = req.params;
  try {
    // Delete associated data first to maintain integrity
    // 1. Payments (via invoices)
    await db.execute({
      sql: "DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id = ?)",
      args: [id]
    });
    // 2. Invoices
    await db.execute({
      sql: "DELETE FROM invoices WHERE company_id = ?",
      args: [id]
    });
    // 3. Suppliers
    await db.execute({
      sql: "DELETE FROM suppliers WHERE company_id = ?",
      args: [id]
    });
    // 4. Company
    await db.execute({
      sql: "DELETE FROM companies WHERE id = ?",
      args: [id]
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/invoices/all", async (req, res) => {
  const companyId = (req.query.companyId as string) ?? null;
  try {
    const result = await db.execute({
      sql: `
        SELECT i.*, s.name as supplier_name, s.alias as supplier_alias
        FROM invoices i
        JOIN suppliers s ON i.supplier_id = s.id
        WHERE i.company_id = ?
        ORDER BY i.issue_date DESC
      `,
      args: [companyId]
    });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/suppliers", async (req, res) => {
  const companyId = (req.query.companyId as string) ?? null;
  try {
    const result = await db.execute({
      sql: `
        SELECT s.*, 
        (SELECT COALESCE(SUM(total_amount), 0) FROM invoices WHERE supplier_id = s.id AND company_id = ?) - 
        (SELECT COALESCE(SUM(p.amount_paid), 0) FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE i.supplier_id = s.id AND i.company_id = ?) as pending_balance
        FROM suppliers s
        WHERE s.company_id = ?
      `,
      args: [companyId, companyId, companyId]
    });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/suppliers/cif/:cif", async (req, res) => {
  const companyId = (req.query.companyId as string) ?? null;
  try {
    const result = await db.execute({
      sql: "SELECT * FROM suppliers WHERE cif = ? AND company_id = ?",
      args: [req.params.cif ?? null, companyId],
    });
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/suppliers", async (req, res) => {
  const { company_id, name, cif, email, address, city, province, zip_code, country_code, alias, phone, name2, address2, main_contact, is_generic } = req.body;
  try {
    // Generate PRovXXX ID based on max current ID FOR THIS COMPANY
    const maxIdResult = await db.execute({
      sql: "SELECT id FROM suppliers WHERE company_id = ? AND id LIKE '%PRov%' ORDER BY id DESC LIMIT 1",
      args: [company_id]
    });
    
    let nextNum = 1;
    if (maxIdResult.rows.length > 0) {
      const lastId = maxIdResult.rows[0].id as string;
      const lastNumPart = lastId.split('PRov').pop();
      const lastNum = lastNumPart ? parseInt(lastNumPart) : NaN;
      if (!isNaN(lastNum)) {
        nextNum = lastNum + 1;
      }
    }
    const id = `${company_id}-PRov${nextNum.toString().padStart(3, '0')}`;
    
    await db.execute({
      sql: "INSERT INTO suppliers (id, company_id, name, cif, email, address, city, province, zip_code, country_code, alias, phone, name2, address2, main_contact, is_generic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        id, 
        company_id ?? null, 
        name ?? null, 
        cif ?? null, 
        email ?? null, 
        address ?? null, 
        city ?? null, 
        province ?? null, 
        zip_code ?? null, 
        country_code ?? 'ES', 
        alias ?? null, 
        phone ?? null, 
        name2 ?? null, 
        address2 ?? null, 
        main_contact ?? null,
        is_generic ?? 0
      ],
    });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete("/api/suppliers/:id", async (req, res) => {
  const { id } = req.params;
  const companyId = (req.query.companyId as string) ?? null;
  console.log(`Attempting to delete supplier ${id} for company ${companyId}`);
  try {
    // Check for associated invoices
    const invoices = await db.execute({
      sql: "SELECT id FROM invoices WHERE supplier_id = ? AND company_id = ?",
      args: [id, companyId]
    });

    if (invoices.rows.length > 0) {
      return res.status(400).json({ error: "No se puede eliminar un proveedor que tiene facturas asociadas. Primero debes eliminar todas sus facturas." });
    }

    await db.execute({
      sql: "DELETE FROM suppliers WHERE id = ? AND company_id = ?",
      args: [id, companyId]
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/suppliers/:id", async (req, res) => {
  const companyId = (req.query.companyId as string) ?? null;
  try {
    const supplier = await db.execute({
      sql: "SELECT * FROM suppliers WHERE id = ? AND company_id = ?",
      args: [req.params.id ?? null, companyId],
    });
    const invoices = await db.execute({
      sql: `
        SELECT i.*, 
        (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE invoice_id = i.id) as paid_amount
        FROM invoices i 
        WHERE i.supplier_id = ? AND i.company_id = ?
      `,
      args: [req.params.id ?? null, companyId],
    });
    res.json({ ...supplier.rows[0], invoices: invoices.rows });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.patch("/api/suppliers/:id", async (req, res) => {
  const { alias, is_generic } = req.body;
  const companyId = (req.query.companyId as string) ?? null;
  try {
    if (is_generic === 1) {
      // Check if another generic supplier exists for this company
      const existingGeneric = await db.execute({
        sql: "SELECT name FROM suppliers WHERE is_generic = 1 AND company_id = ? AND id != ?",
        args: [companyId, req.params.id],
      });
      if (existingGeneric.rows.length > 0) {
        return res.status(400).json({ error: `Ya existe un proveedor genérico para esta compañía: ${existingGeneric.rows[0].name}` });
      }
    }

    const updates = [];
    const args = [];
    if (alias !== undefined) {
      updates.push("alias = ?");
      args.push(alias);
    }
    if (is_generic !== undefined) {
      updates.push("is_generic = ?");
      args.push(is_generic);
    }
    
    if (updates.length > 0) {
      args.push(req.params.id, companyId);
      await db.execute({
        sql: `UPDATE suppliers SET ${updates.join(", ")} WHERE id = ? AND company_id = ?`,
        args,
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/movements/all", async (req, res) => {
  const companyId = (req.query.companyId as string) ?? null;
  try {
    const invoices = await db.execute({
      sql: `
        SELECT i.id, i.doc_id, i.doc_ext, i.invoice_number as reference, i.issue_date as date, i.total_amount as amount, 'Alta Factura' as type, s.name as supplier_name, s.alias as supplier_alias, i.supplier_id
        FROM invoices i
        JOIN suppliers s ON i.supplier_id = s.id
        WHERE i.company_id = ?
      `,
      args: [companyId]
    });
    const payments = await db.execute({
      sql: `
        SELECT p.id, i.doc_id, i.doc_ext, i.invoice_number as reference, p.payment_date as date, p.amount_paid as amount, 'Liq Factura' as type, p.bank_movement_id, s.name as supplier_name, s.alias as supplier_alias, i.supplier_id
        FROM payments p
        JOIN invoices i ON p.invoice_id = i.id
        JOIN suppliers s ON i.supplier_id = s.id
        WHERE i.company_id = ?
      `,
      args: [companyId]
    });
    
    const movements = [...invoices.rows, ...payments.rows].sort((a: any, b: any) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    
    res.json(movements);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/suppliers/:id/movements", async (req, res) => {
  const companyId = (req.query.companyId as string) ?? null;
  try {
    const invoices = await db.execute({
      sql: `
        SELECT i.id, i.doc_id, i.doc_ext, i.invoice_number as reference, i.issue_date as date, i.total_amount as amount, 'Alta Factura' as type, 
               s.name as supplier_name, s.alias as supplier_alias, i.supplier_id
        FROM invoices i
        JOIN suppliers s ON i.supplier_id = s.id
        WHERE i.supplier_id = ? AND i.company_id = ?
      `,
      args: [req.params.id ?? null, companyId],
    });
    const payments = await db.execute({
      sql: `
        SELECT p.id, i.doc_id, i.doc_ext, i.invoice_number as reference, p.payment_date as date, p.amount_paid as amount, 'Liq Factura' as type, 
               p.bank_movement_id, s.name as supplier_name, s.alias as supplier_alias, i.supplier_id
        FROM payments p
        JOIN invoices i ON p.invoice_id = i.id
        JOIN suppliers s ON i.supplier_id = s.id
        WHERE i.supplier_id = ? AND i.company_id = ?
      `,
      args: [req.params.id ?? null, companyId],
    });
    
    const movements = [...invoices.rows, ...payments.rows].sort((a: any, b: any) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    
    res.json(movements);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/invoices", async (req, res) => {
  const { company_id, supplier_id, invoice_number, doc_id, doc_ext, issue_date, due_date, tax_base, vat, total_amount, concept } = req.body;
  try {
    // Global duplicate check for internal DOC ID (doc_id)
    if (doc_id) {
      const existingDoc = await db.execute({
        sql: "SELECT id FROM invoices WHERE doc_id = ? AND company_id = ?",
        args: [doc_id ?? null, company_id ?? null],
      });
      if (existingDoc.rows.length > 0) {
        return res.status(400).json({ error: `El número DOC (Int) ${doc_id} ya existe en el sistema para esta compañía.` });
      }
    }

    // Duplicate check: same supplier and same external invoice number
    const existing = await db.execute({
      sql: "SELECT id FROM invoices WHERE supplier_id = ? AND company_id = ? AND (doc_ext = ? OR invoice_number = ?)",
      args: [supplier_id ?? null, company_id ?? null, (doc_ext || invoice_number) ?? null, (invoice_number || doc_ext) ?? null],
    });

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: `Factura duplicada detectada para este proveedor (Nº: ${doc_ext || invoice_number})` });
    }

    const result = await db.execute({
      sql: "INSERT INTO invoices (company_id, supplier_id, invoice_number, doc_id, doc_ext, issue_date, due_date, tax_base, vat, total_amount, concept) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        company_id ?? null, 
        supplier_id ?? null, 
        invoice_number ?? null, 
        doc_id ?? null, 
        doc_ext ?? null, 
        issue_date ?? null, 
        due_date ?? null, 
        tax_base ?? 0, 
        vat ?? 0, 
        total_amount ?? null,
        concept ?? "Factura genérica"
      ],
    });
    res.json({ id: Number(result.lastInsertRowid) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/invoices/:id", async (req, res) => {
  const { id } = req.params;
  console.log(`[GET] Fetching invoice details for ID: ${id}`);
  try {
    const result = await db.execute({
      sql: `
        SELECT i.*, s.name as supplier_name, s.cif as supplier_cif, s.address as supplier_address, 
               s.city as supplier_city, s.province as supplier_province, s.zip_code as supplier_zip_code,
               s.country_code as supplier_country_code
        FROM invoices i
        JOIN suppliers s ON i.supplier_id = s.id
        WHERE i.id = ?
      `,
      args: [Number(id)]
    });

    if (result.rows.length === 0) {
      console.warn(`[GET] Invoice ${id} not found`);
      return res.status(404).json({ error: "Factura no encontrada" });
    }

    console.log(`[GET] Invoice ${id} found:`, result.rows[0].doc_id);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(`[GET] Error fetching invoice ${id}:`, err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.patch("/api/invoices/:id", async (req, res) => {
  const { concept, doc_ext, issue_date, due_date } = req.body;
  const { id } = req.params;
  console.log(`[PATCH] Updating invoice ${id}:`, { concept, doc_ext, issue_date, due_date });
  try {
    const updates: string[] = [];
    const args: any[] = [];

    if (concept !== undefined) {
      updates.push("concept = ?");
      args.push(concept);
    }
    if (doc_ext !== undefined) {
      updates.push("doc_ext = ?");
      args.push(doc_ext);
    }
    if (issue_date !== undefined) {
      updates.push("issue_date = ?");
      args.push(issue_date);
    }
    if (due_date !== undefined) {
      updates.push("due_date = ?");
      args.push(due_date);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No se proporcionaron campos para actualizar" });
    }

    args.push(Number(id));

    await db.execute({
      sql: `UPDATE invoices SET ${updates.join(", ")} WHERE id = ?`,
      args,
    });
    console.log(`[PATCH] Invoice ${id} updated successfully`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[PATCH] Error updating invoice ${id}:`, err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/payments", async (req, res) => {
  const { invoice_id, payment_date, amount_paid, method, bank_movement_id } = req.body;
  try {
    await db.batch([
      {
        sql: "INSERT INTO payments (invoice_id, payment_date, amount_paid, method, bank_movement_id) VALUES (?, ?, ?, ?, ?)",
        args: [
          invoice_id ?? null, 
          payment_date ?? null, 
          amount_paid ?? null, 
          method ?? null, 
          bank_movement_id ?? null
        ],
      }
    ], "write");

    // Update invoice status
    const invData = await db.execute({
      sql: `
        SELECT total_amount, 
        (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE invoice_id = ?) as total_paid
        FROM invoices WHERE id = ?
      `,
      args: [invoice_id ?? null, invoice_id ?? null],
    });

    const { total_amount, total_paid } = invData.rows[0] as any;
    let status = "Partial";
    if (total_paid >= total_amount - 0.01) status = "Paid";
    
    await db.execute({
      sql: "UPDATE invoices SET status = ? WHERE id = ?",
      args: [status, invoice_id],
    });

    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/payments/batch", async (req, res) => {
  const { invoice_payments, payment_date, method, bank_movement_id } = req.body;
  // invoice_payments is an array of { invoice_id: number, amount_paid: number }
  try {
    const statements = [];
    
    for (const p of invoice_payments) {
      statements.push({
        sql: "INSERT INTO payments (invoice_id, payment_date, amount_paid, method, bank_movement_id) VALUES (?, ?, ?, ?, ?)",
        args: [
          p.invoice_id, 
          payment_date ?? null, 
          p.amount_paid, 
          method ?? 'Transfer', 
          bank_movement_id ?? null
        ]
      });
    }
    
    await db.batch(statements, "write");

    // Update statuses for all affected invoices
    for (const p of invoice_payments) {
      const invData = await db.execute({
        sql: `
          SELECT total_amount, 
          (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE invoice_id = ?) as total_paid
          FROM invoices WHERE id = ?
        `,
        args: [p.invoice_id, p.invoice_id],
      });

      if (invData.rows.length > 0) {
        const { total_amount, total_paid } = invData.rows[0] as any;
        let status = "Partial";
        if (total_paid >= total_amount - 0.01) status = "Paid";
        
        await db.execute({
          sql: "UPDATE invoices SET status = ? WHERE id = ?",
          args: [status, p.invoice_id],
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete("/api/payments/:id", async (req, res) => {
  const { id } = req.params;
  console.log(`[DELETE] /api/payments/${id} called`);
  try {
    // Get invoice_id before deleting
    const payment = await db.execute({
      sql: "SELECT invoice_id FROM payments WHERE id = ?",
      args: [id]
    });

    if (payment.rows.length === 0) {
      console.log(`[DELETE] Payment ${id} not found`);
      return res.status(404).json({ error: "Liquidación no encontrada" });
    }

    const invoiceId = payment.rows[0].invoice_id;
    console.log(`[DELETE] Found invoice_id: ${invoiceId} for payment ${id}`);

    await db.execute({
      sql: "DELETE FROM payments WHERE id = ?",
      args: [id]
    });
    console.log(`[DELETE] Payment ${id} deleted successfully`);

    // Recalculate invoice status
    const invData = await db.execute({
      sql: `
        SELECT total_amount, 
        (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE invoice_id = ?) as total_paid
        FROM invoices WHERE id = ?
      `,
      args: [invoiceId, invoiceId],
    });

    if (invData.rows.length > 0) {
      const { total_amount, total_paid } = invData.rows[0] as any;
      let status = "Pending";
      if (total_paid > 0 && total_paid < total_amount) status = "Partial";
      if (total_paid >= total_amount && total_amount > 0) status = "Paid";
      
      console.log(`[DELETE] Recalculated status for invoice ${invoiceId}: ${status} (paid: ${total_paid}, total: ${total_amount})`);

      await db.execute({
        sql: "UPDATE invoices SET status = ? WHERE id = ?",
        args: [status, invoiceId],
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(`[DELETE] Error deleting payment ${id}:`, err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete("/api/invoices/:id", async (req, res) => {
  const { id } = req.params;
  try {
    // Check for associated payments
    const payments = await db.execute({
      sql: "SELECT id FROM payments WHERE invoice_id = ?",
      args: [id]
    });

    if (payments.rows.length > 0) {
      return res.status(400).json({ error: "No se puede eliminar una factura que tiene liquidaciones asociadas." });
    }

    await db.execute({
      sql: "DELETE FROM invoices WHERE id = ?",
      args: [id]
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/test", async (req, res) => {
  try {
    const result = await db.execute("SELECT 1 as connected");
    res.json({ 
      status: "ok", 
      message: "Conexión con Turso exitosa",
      data: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ 
      status: "error", 
      message: "Error al conectar con la base de datos",
      error: (error as Error).message 
    });
  }
});

async function startServer() {
  // Solo configuramos Vite si NO estamos en Vercel y NO estamos en producción
  if (!process.env.VERCEL && process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error("Vite middleware failed to load:", e);
    }
  } else if (!process.env.VERCEL) {
    // Si estamos en producción local (no Vercel), servimos estáticos
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  // En Vercel, no servimos estáticos ni Vite desde aquí, Vercel lo hace vía vercel.json
}

// Solo escuchamos en el puerto si NO estamos en Vercel
if (!process.env.VERCEL) {
  startServer().then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
}

export default app;
