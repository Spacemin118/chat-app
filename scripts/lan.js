// Starts the chat server on every network interface so other machines on the
// same LAN can join, and prints the tokenised URL to hand out.
import crypto from "node:crypto";
import os from "node:os";

const token = process.env.LIGHT_CHAT_TOKEN || crypto.randomBytes(24).toString("hex");
process.env.LIGHT_CHAT_TOKEN = token;
process.env.LIGHT_CHAT_HOST = process.env.LIGHT_CHAT_HOST || "0.0.0.0";

const { start } = await import("../server.js");

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(entry => entry && entry.family === "IPv4" && !entry.internal)
    .map(entry => entry.address);
}

try {
  const { port } = await start();
  const addresses = lanAddresses();
  console.log(`Light Chat is listening on ${process.env.LIGHT_CHAT_HOST}:${port}`);
  console.log(`Access token: ${token}`);
  console.log("");
  if (addresses.length === 0) {
    console.log("No LAN address found - is this machine connected to a network?");
  } else {
    console.log("Share one of these links with people on the same network:");
    for (const address of addresses) console.log(`  http://${address}:${port}/?token=${token}`);
  }
  console.log("");
  console.log("Anyone with the link and token can read and post - only share it on a network you trust.");
  if (process.platform === "win32") {
    console.log("If nobody can connect, allow the port through the firewall (once, as Administrator):");
    console.log(
      `  New-NetFirewallRule -DisplayName "Light Chat" -Direction Inbound -LocalPort ${port} -Protocol TCP -Action Allow`
    );
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
