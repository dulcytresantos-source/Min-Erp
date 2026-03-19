import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Turso Database Client
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Initialize Database
async function initDb() {
  try {
    // We no longer drop tables automatically for "real" database use.
    // await db.execute("DROP TABLE IF EXISTS payments");
    // await db.execute("DROP TABLE IF EXISTS invoices");
    // await db.execute("DROP TABLE IF EXISTS suppliers");

    await db.execute(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT,
        cif TEXT,
        is_default INTEGER DEFAULT 0
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS suppliers (
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
        FOREIGN KEY (company_id) REFERENCES companies (id)
      )
    `);

    // Migration: Ensure company_id exists in suppliers
    try {
      await db.execute("ALTER TABLE suppliers ADD COLUMN company_id INTEGER REFERENCES companies(id)");
    } catch (e) {
      // Column might already exist
    }

    // Migration: Remove global unique constraint on CIF if it exists as an index
    // and create a per-company unique index
    try {
      // Try to drop common names for this index if it was created explicitly
      await db.execute("DROP INDEX IF EXISTS idx_suppliers_cif");
      await db.execute("DROP INDEX IF EXISTS suppliers_cif_unique");
      await db.execute("DROP INDEX IF EXISTS cif_unique");
      
      // If it was a column constraint, we might need to recreate the column (aggressive migration)
      // We only do this if the index creation fails or as a proactive measure
      // But let's try the index first as it's safer.
      await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_company_cif ON suppliers (company_id, cif)");
    } catch (e) {
      console.error("Error updating suppliers indexes, attempting column recreation:", e);
      try {
        // Aggressive migration for suppliers.cif
        await db.execute("ALTER TABLE suppliers RENAME COLUMN cif TO cif_old");
        await db.execute("ALTER TABLE suppliers ADD COLUMN cif TEXT");
        await db.execute("UPDATE suppliers SET cif = cif_old");
        await db.execute("ALTER TABLE suppliers DROP COLUMN cif_old");
        await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_company_cif ON suppliers (company_id, cif)");
      } catch (innerE) {
        console.error("Aggressive suppliers migration failed:", innerE);
      }
    }

    await db.execute(`
      CREATE TABLE IF NOT EXISTS invoices (
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
        FOREIGN KEY (company_id) REFERENCES companies (id),
        FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
      )
    `);

    // Migration: Remove global unique constraint on doc_id in invoices
    try {
      // Recreate doc_id column if it was UNIQUE
      await db.execute("ALTER TABLE invoices RENAME COLUMN doc_id TO doc_id_old");
      await db.execute("ALTER TABLE invoices ADD COLUMN doc_id TEXT");
      await db.execute("UPDATE invoices SET doc_id = doc_id_old");
      await db.execute("ALTER TABLE invoices DROP COLUMN doc_id_old");
    } catch (e) {
      // Column might already be non-unique or already migrated
    }

    // Migration: Ensure company_id exists in invoices
    try {
      await db.execute("ALTER TABLE invoices ADD COLUMN company_id INTEGER REFERENCES companies(id)");
    } catch (e) {
      // Column might already exist
    }

    await db.execute(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        payment_date TEXT,
        amount_paid REAL NOT NULL,
        method TEXT,
        bank_movement_id TEXT,
        FOREIGN KEY (invoice_id) REFERENCES invoices (id)
      )
    `);

    // Add unique indexes
    try {
      await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_unique ON invoices (company_id, supplier_id, doc_ext)`);
    } catch (e) {}
    try {
      await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_unique_num ON invoices (company_id, supplier_id, invoice_number)`);
    } catch (e) {}
    try {
      await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_doc_id ON invoices (company_id, doc_id)`);
    } catch (e) {}

    // Seed Data - Only if database is empty
    const companyCountResult = await db.execute("SELECT COUNT(*) as count FROM companies");
    const companyCount = Number(companyCountResult.rows[0].count);

    if (companyCount === 0) {
      await db.execute({
        sql: "INSERT INTO companies (name, address, cif, is_default) VALUES (?, ?, ?, ?)",
        args: ["MI EMPRESA S.L.", "CALLE MAYOR 1, MADRID", "B12345678", 1]
      });
    }

    const defaultCompanyResult = await db.execute("SELECT id FROM companies WHERE is_default = 1 LIMIT 1");
    const defaultCompanyId = Number(defaultCompanyResult.rows[0].id);

    // Update existing records with default company if they have NULL company_id
    await db.execute({
      sql: "UPDATE suppliers SET company_id = ? WHERE company_id IS NULL",
      args: [defaultCompanyId],
    });
    await db.execute({
      sql: "UPDATE invoices SET company_id = ? WHERE company_id IS NULL",
      args: [defaultCompanyId],
    });

    const countResult = await db.execute("SELECT COUNT(*) as count FROM suppliers");
    const count = Number(countResult.rows[0].count);

    if (count === 0) {
      const seedSuppliers = [
        { id: 'PRov001', name: 'Coca-Cola European Partners', cif: 'A86561712', email: 'billing@cocacola.com', address: 'Calle de la Ribera del Loira, 20', city: 'Madrid', province: 'Madrid', zip_code: '28042', country_code: 'ES', alias: 'COCACOLA', phone: '913345000' },
        { id: 'PRov002', name: 'IBM España S.A.', cif: 'A28010644', email: 'invoices@es.ibm.com', address: 'Calle de Santa Hortensia, 26', city: 'Madrid', province: 'Madrid', zip_code: '28002', country_code: 'ES', alias: 'IBM', phone: '913976000' },
        { id: 'PRov003', name: 'Telefónica S.A.', cif: 'A28015865', email: 'proveedores@telefonica.com', address: 'Gran Vía, 28', city: 'Madrid', province: 'Madrid', zip_code: '28013', country_code: 'ES', alias: 'TELEFONICA', phone: '915840306' },
        { id: 'PRov004', name: 'Inditex S.A.', cif: 'A15075062', email: 'finance@inditex.com', address: 'Avenida de la Diputación', city: 'Arteixo', province: 'A Coruña', zip_code: '15143', country_code: 'ES', alias: 'INDITEX', phone: '981185400' },
        { id: 'PRov005', name: 'Banco Santander S.A.', cif: 'A39000013', email: 'pagos@santander.com', address: 'Paseo de Pereda, 9-12', city: 'Santander', province: 'Cantabria', zip_code: '39004', country_code: 'ES', alias: 'SANTANDER', phone: '942206100' }
      ];

      for (const s of seedSuppliers) {
        await db.execute({
          sql: "INSERT INTO suppliers (id, company_id, name, cif, email, address, city, province, zip_code, country_code, alias, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          args: [s.id, defaultCompanyId, s.name, s.cif, s.email, s.address, s.city, s.province, s.zip_code, s.country_code, s.alias, s.phone]
        });
      }

      // Seed Invoices & Payments (Demo Movements 2026)
      const suppliers = ['PRov001', 'PRov002', 'PRov003', 'PRov004', 'PRov005'];
      const statuses = ['Paid', 'Partial', 'Pending'];
      
      for (const sId of suppliers) {
        const count = sId === 'PRov001' ? 20 : 9;
        const alias = seedSuppliers.find(s => s.id === sId)?.alias || 'SUP';
        
        for (let i = 1; i <= count; i++) {
          const month = Math.floor((i - 1) / (count / 12)) + 1;
          const day = (i * 3) % 28 + 1;
          const dateStr = `2026-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
          const dueDate = `2026-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
          
          const status = statuses[i % 3];
          const base = 100 * i + (Math.random() * 50);
          const total = base * 1.21;
          const docId = `26-${alias}-${i.toString().padStart(2, '0')}`;
          const invNum = `INV-26-${i.toString().padStart(3, '0')}`;

          const result = await db.execute({
            sql: "INSERT INTO invoices (company_id, supplier_id, doc_id, doc_ext, invoice_number, issue_date, due_date, tax_base, vat, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            args: [defaultCompanyId, sId, docId, invNum, invNum, dateStr, dueDate, base, base * 0.21, total, status]
          });
          
          const invoiceId = Number(result.lastInsertRowid);

          if (status === 'Paid') {
            await db.execute({
              sql: "INSERT INTO payments (invoice_id, payment_date, amount_paid, method, bank_movement_id) VALUES (?, ?, ?, ?, ?)",
              args: [invoiceId, dueDate, total, 'Transfer', `BANK-26-${sId}-${i}`]
            });
          } else if (status === 'Partial') {
            await db.execute({
              sql: "INSERT INTO payments (invoice_id, payment_date, amount_paid, method, bank_movement_id) VALUES (?, ?, ?, ?, ?)",
              args: [invoiceId, dateStr, total / 2, 'Transfer', `BANK-26-PART-${sId}-${i}`]
            });
          }
        }
      }
      console.log("Extensive 2026 Demo Data initialized");
    }

    console.log("Database initialized");
  } catch (err) {
    console.error("Database initialization failed:", err);
  }
}

initDb();

// API Routes
app.get("/api/companies", async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM companies ORDER BY name ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
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
  const { company_id, name, cif, email, address, city, province, zip_code, country_code, alias, phone, name2, address2, main_contact } = req.body;
  try {
    // Generate PRovXXX ID based on max current ID to avoid collisions
    const maxIdResult = await db.execute("SELECT id FROM suppliers WHERE id LIKE 'PRov%' ORDER BY id DESC LIMIT 1");
    let nextNum = 1;
    if (maxIdResult.rows.length > 0) {
      const lastId = maxIdResult.rows[0].id as string;
      const lastNum = parseInt(lastId.replace('PRov', ''));
      if (!isNaN(lastNum)) {
        nextNum = lastNum + 1;
      }
    }
    const id = `PRov${nextNum.toString().padStart(3, '0')}`;
    
    await db.execute({
      sql: "INSERT INTO suppliers (id, company_id, name, cif, email, address, city, province, zip_code, country_code, alias, phone, name2, address2, main_contact) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        main_contact ?? null
      ],
    });
    res.json({ id });
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
  const { company_id, supplier_id, invoice_number, doc_id, doc_ext, issue_date, due_date, tax_base, vat, total_amount } = req.body;
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
      sql: "INSERT INTO invoices (company_id, supplier_id, invoice_number, doc_id, doc_ext, issue_date, due_date, tax_base, vat, total_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        total_amount ?? null
      ],
    });
    res.json({ id: Number(result.lastInsertRowid) });
  } catch (err) {
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
    if (total_paid >= total_amount) status = "Paid";
    
    await db.execute({
      sql: "UPDATE invoices SET status = ? WHERE id = ?",
      args: [status, invoice_id],
    });

    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
