
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
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || "Error al procesar la factura en el servidor");
      } else {
        const text = await response.text();
        // If it's an HTML error page, extract the status text or first line
        const errorMsg = text.includes("<title>") 
          ? text.match(/<title>(.*?)<\/title>/)?.[1] || "Error del servidor (HTML)"
          : text.slice(0, 100);
        
        if (response.status === 404) {
          throw new Error("Error 404: La ruta /api/parse-invoice no fue encontrada. Verifica la configuración de Vercel.");
        }
        
        throw new Error(`Error ${response.status}: ${errorMsg}`);
      }
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse JSON response:", text);
      throw new Error("El servidor devolvió una respuesta que no es JSON válido. Es posible que haya un error en la configuración de Vercel.");
    }
  } catch (error) {
    console.error("Error calling parse-invoice API:", error);
    throw error;
  }
}
