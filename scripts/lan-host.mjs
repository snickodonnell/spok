/**
 * Print LAN IPv4 addresses and optional bind hints for phone/tablet access.
 * Usage: node scripts/lan-host.mjs
 */

import os from "node:os";

function lanIPv4s() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue;
    for (const info of list) {
      if (info.family !== "IPv4" && info.family !== 4) continue;
      if (info.internal) continue;
      out.push({ name, address: info.address });
    }
  }
  return out;
}

const port = process.env.PORT || process.env.SPOK_PORT || "3000";
const addrs = lanIPv4s();

console.log("");
console.log("Spok LAN URLs (same Wi‑Fi):");
if (addrs.length === 0) {
  console.log("  (no non-loopback IPv4 found — check Wi‑Fi / Ethernet)");
} else {
  for (const { name, address } of addrs) {
    console.log(`  http://${address}:${port}   (${name})`);
  }
}
console.log("");
console.log("On this PC:");
console.log(`  http://localhost:${port}`);
console.log("");
console.log("Requirements:");
console.log("  • Server bound to 0.0.0.0 (npm run dev:lan / start:lan)");
console.log("  • SPOK_LAN_ACCESS=1 so Host/Origin accept private IPs");
console.log("  • Windows Firewall may prompt — allow Node.js on Private networks");
console.log("");
