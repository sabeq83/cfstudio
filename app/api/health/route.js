import { readConfig } from "../../../lib/runtime-config.js";
export async function GET() {
  const c = readConfig(process.env, { requireDatabase: false });
  return Response.json(
    {
      app: "CF Studio",
      version: "3.0.0-alpha.8",
      databaseConfigured: Boolean(c.databaseUrl),
      productionDispatch: c.productionDispatch,
      publishingDispatch: c.publishingDispatch,
      telegramDispatch: process.env.ENABLE_TELEGRAM_DISPATCH === "true",
      status: "development",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
