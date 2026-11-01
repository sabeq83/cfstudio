export { claimRun } from "./production-worker.js";
export async function completeRun(db, claim, output) {
  const { rowCount } = await db.query(
    `UPDATE automation_runs SET status='completed',lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 AND tenant_id=$2 AND lease_owner=$3 AND fencing_token=$4 AND lease_expires_at>now()`,
    [claim.id, claim.tenant_id, claim.lease_owner, claim.fencing_token],
  );
  if (!rowCount) {
    const e = new Error("STALE_LEASE");
    e.code = "STALE_LEASE";
    throw e;
  }
  return output;
}
