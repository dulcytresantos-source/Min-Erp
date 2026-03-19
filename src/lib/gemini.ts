import { GoogleGenAI, Type } from "@google/genai";

export async function parseInvoice(base64Data: string, mimeType: string) {
  // Use the standard process.env.GEMINI_API_KEY as per AI Studio guidelines
  const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Falta la API Key de Gemini. Por favor, configúrala en los Secrets de AI Studio como GEMINI_API_KEY.");
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const model = "gemini-3-flash-preview";
    const prompt = `Analiza esta factura y extrae la siguiente información en español:
    - Nombre del Proveedor (Supplier Name)
    - CIF/NIF del proveedor (Tax ID)
    - Número de Factura (Invoice Number)
    - Fecha de Emisión (Issue Date) en formato YYYY-MM-DD
    - Fecha de Vencimiento (Due Date) en formato YYYY-MM-DD
    - Base Imponible (Tax Base) - solo el número
    - Cuota de IVA (VAT Amount) - solo el número
    - Importe Total (Total Amount) - solo el número
    - Dirección del Proveedor
    - Email del Proveedor
    - Teléfono del Proveedor
    - Ciudad del Proveedor
    - Código Postal del Proveedor
    - Provincia del Proveedor
    - Alias del Proveedor (un nombre corto o comercial)
    
    Asegúrate de que los importes sean números válidos. Si no encuentras algún campo, deja el valor como null o string vacío según corresponda.
    Devuelve los datos estrictamente en formato JSON.`;

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType,
              },
            },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            supplierName: { type: Type.STRING },
            cif: { type: Type.STRING },
            invoiceNumber: { type: Type.STRING },
            issueDate: { type: Type.STRING },
            dueDate: { type: Type.STRING },
            taxBase: { type: Type.NUMBER },
            vat: { type: Type.NUMBER },
            totalAmount: { type: Type.NUMBER },
            address: { type: Type.STRING },
            email: { type: Type.STRING },
            phone: { type: Type.STRING },
            city: { type: Type.STRING },
            zipCode: { type: Type.STRING },
            province: { type: Type.STRING },
            alias: { type: Type.STRING },
          },
          required: ["supplierName", "cif", "totalAmount"],
        },
      },
    });

    const text = response.text || "{}";
    return JSON.parse(text);
  } catch (error) {
    console.error("Error parsing invoice with Gemini:", error);
    throw error;
  }
}
