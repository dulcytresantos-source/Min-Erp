import { createClient } from "@libsql/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { method } = req;
  const { id } = req.query;

  try {
    if (method === "DELETE") {
      if (!id) {
        return res.status(400).json({ error: "ID de factura requerido" });
      }

      // Check for associated payments
      const payments = await db.execute({
        sql: "SELECT id FROM payments WHERE invoice_id = ?",
        args: [id as string]
      });

      if (payments.rows.length > 0) {
        return res.status(400).json({ error: "No se puede eliminar una factura que tiene liquidaciones asociadas." });
      }

      await db.execute({
        sql: "DELETE FROM invoices WHERE id = ?",
        args: [id as string]
      });

      return res.status(200).json({ success: true });
    }

    if (method === "PATCH") {
      const { concept } = req.body;
      if (!id) {
        return res.status(400).json({ error: "ID de factura requerido" });
      }

      await db.execute({
        sql: "UPDATE invoices SET concept = ? WHERE id = ?",
        args: [concept ?? null, id as string],
      });
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", ["DELETE", "PATCH"]);
    return res.status(405).end(`Método ${method} no permitido`);
  } catch (error) {
    console.error(`Error en /api/invoices/${id} [${method}]:`, error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: (error as Error).message 
    });
  }
}
