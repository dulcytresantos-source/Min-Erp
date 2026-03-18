import { createClient } from "@libsql/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDb() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        cif TEXT,
        address TEXT,
        is_default INTEGER DEFAULT 0
      )
    `);
  } catch (error) {
    console.error("Error al inicializar la tabla 'companies':", error);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Inicializar la tabla si no existe
  await initDb();

  const { method } = req;

  try {
    if (method === "GET") {
      // Listar empresas
      const result = await db.execute("SELECT * FROM companies ORDER BY id DESC");
      return res.status(200).json(result.rows);
    } 
    
    if (method === "POST") {
      // Crear empresa
      const { name, cif, address } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: "El nombre de la empresa es obligatorio" });
      }

      const result = await db.execute({
        sql: "INSERT INTO companies (name, cif, address) VALUES (?, ?, ?)",
        args: [name, cif || null, address || null],
      });
      
      return res.status(201).json({ 
        id: Number(result.lastInsertRowid),
        message: "Empresa creada exitosamente" 
      });
    }

    // Método no permitido
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Método ${method} no permitido`);

  } catch (error) {
    console.error(`Error en endpoint /api/companies [${method}]:`, error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: (error as Error).message 
    });
  }
}
