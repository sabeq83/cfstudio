import { execFileSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
const command = process.argv[2] || "status";
if (!["start", "stop", "status"].includes(command))
  throw new Error("Gunakan start, stop, atau status.");
const root = path.resolve("runtime/postgres");
if (!existsSync(path.join(root, "PG_VERSION")))
  throw new Error("LOCAL_CLUSTER_NOT_INITIALIZED");
const bin =
  process.env.CF_PG_CTL || "/opt/homebrew/opt/postgresql@17/bin/pg_ctl";
const args = ["-D", root];
if (command === "start")
  args.push("-l", path.resolve("runtime/postgres.log"), "start");
else if (command === "stop") args.push("stop", "-m", "fast");
else args.push("status");
try {
  execFileSync(bin, args, { stdio: "inherit" });
} catch {
  process.exitCode = 1;
}
