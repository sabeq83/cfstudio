import { randomUUID } from "node:crypto";
import { hashPassword } from "../lib/security.js";
import { transaction, getPool } from "../lib/db-pg.js";
if (
  !process.env.CF_ADMIN_USERNAME ||
  !process.env.CF_ADMIN_PASSWORD ||
  !process.env.TARGET_TENANT_ID
)
  throw new Error(
    "CF_ADMIN_USERNAME, CF_ADMIN_PASSWORD, TARGET_TENANT_ID wajib pada environment lokal.",
  );
try {
  await transaction(async (db) => {
    const tenantId = process.env.TARGET_TENANT_ID;
    await db.query(
      "INSERT INTO tenants(id,name) VALUES($1,'Default tenant CF Studio') ON CONFLICT DO NOTHING",
      [tenantId],
    );
    await db.query(
      `INSERT INTO users(id,tenant_id,username,password_hash,capabilities,all_brands,role) VALUES($1,$2,$3,$4,$5,true,'admin') ON CONFLICT(tenant_id,username) DO NOTHING`,
      [
        randomUUID(),
        tenantId,
        process.env.CF_ADMIN_USERNAME,
        hashPassword(process.env.CF_ADMIN_PASSWORD),
        JSON.stringify([
          "catalog.read",
          "catalog.manage",
          "automation.read",
          "automation.manage",
          "production.run",
          "content.edit",
          "content.approve",
          "publishing.schedule",
          "publishing.cancel",
          "integration.manage",
          "tenant.users.manage",
        ]),
      ],
    );
  });
  console.log("Tenant/admin disiapkan. Password dan token tidak dicetak.");
} finally {
  await getPool().end();
}
