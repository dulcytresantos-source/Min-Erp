
export async function parseInvoice(base64Data: string, mimeType: string) {
  try {
    const response = await fetch("/api/parse-invoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ base64Data, mimeType }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Error al procesar la factura en el servidor");
    }

    return await response.json();
  } catch (error) {
    console.error("Error calling parse-invoice API:", error);
    throw error;
  }
}
