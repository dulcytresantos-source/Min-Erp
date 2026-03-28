export default async function handler(req: any, res: any) {
  try {
    return res.status(200).json({
      ok: true,
      phase: "ping",
      message: "La función arranca bien"
    });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      phase: "ping-catch",
      error: e?.message || String(e)
    });
  }
}
