import { processCatalogAnalysis } from "../lib/lab-service.js";
import { randomUUID } from "node:crypto";
import { scheduleDue, processProduction } from "../lib/production-worker.js";
import {
  processPublishing,
  reconcilePublishing,
} from "../lib/publishing-service.js";
import { deliverNotification } from "../lib/notification-service.js";
import { getPool } from "../lib/db-pg.js";
const id = "cf-" + randomUUID();
let stop = false;
process.on("SIGINT", () => (stop = true));
process.on("SIGTERM", () => (stop = true));
const once = process.argv.includes("--once");
do {
  try {
    if (process.env.ENABLE_PRODUCTION_DISPATCH === "true") {
      await scheduleDue();
      await processCatalogAnalysis(id);
      await processProduction(id);
    }
    if (process.env.ENABLE_PUBLISHING_DISPATCH === "true") {
      await processPublishing(id);
      await reconcilePublishing();
    }
    if (process.env.ENABLE_TELEGRAM_DISPATCH === "true")
      await deliverNotification(id);
  } catch (e) {
    console.error(
      JSON.stringify({ worker: id, code: e.code || "WORKER_TICK_FAILED" }),
    );
  }
  if (!once && !stop) await new Promise((r) => setTimeout(r, 5000));
} while (!once && !stop);
await getPool().end();
