import { GoogleGenAI, Type } from "@google/genai";

export async function parseInvoice(base64Data: string, mimeType: string) {
  // Try both VITE_API_KEY and VITE_GEMINI_API_KEY for compatibility
  const apiKey = (import.meta as any).env?.VITE_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Falta VITE_API_KEY en Vercel (Settings → Environment Variables).");
  }

  const ai = new GoogleGenAI({ apiKey });

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

    const text = response.text || "{}";
    return JSON.parse(text);
  } catch (error) {
    console.error("Error parsing invoice with Gemini:", error);
    throw error;
  }
}
