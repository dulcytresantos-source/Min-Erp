import { GoogleGenAI, Type } from "@google/genai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { base64Data, mimeType } = req.body;

  if (!base64Data || !mimeType) {
    return res.status(400).json({ error: "Missing base64Data or mimeType" });
  }

  try {
    const model = "gemini-3-flash-preview";
    const prompt = `Extract the following information from this invoice:
    - Supplier Name
    - CIF/NIF (Tax ID) of the supplier
    - Invoice Number
    - Issue Date (in YYYY-MM-DD format)
    - Due Date (in YYYY-MM-DD format)
    - Tax Base (Base Imponible)
    - VAT Amount (IVA)
    - Total Amount (as a number)
    - Supplier Address
    - Supplier Email
    - Supplier Phone
    - Supplier City
    - Supplier Zip Code
    - Supplier Province
    - Supplier Alias (short name)
    
    Return the data in JSON format.`;

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

    return res.status(200).json(JSON.parse(response.text || "{}"));
  } catch (error) {
    console.error("Error parsing invoice with Gemini:", error);
    return res.status(500).json({ 
      error: "Error processing invoice", 
      message: (error as Error).message 
    });
  }
}
