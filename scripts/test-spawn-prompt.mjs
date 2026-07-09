import { spawn } from "child_process";

function quoteArg(arg) {
  if (arg.length === 0) return '""';
  if (!/[\s"&<>|^%!()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

const prompt = "Audit this repo and create a plan.md for improving it.";
const full = ["--always-approve", "--output-format", "streaming-json", "-p", prompt];

console.log("cmdline:", ["grok", ...full.map(quoteArg)].join(" "));
console.log("argv JSON:", JSON.stringify(["grok", ...full]));

// Dry-run: use --help instead of real agent call to verify argv parsing
// If -p were split, grok would error on subcommand "repo"
const child = spawn("grok", full, {
  shell: false,
  windowsHide: true,
  cwd: process.cwd(),
});

let err = "";
let out = "";
child.stderr.on("data", (d) => {
  err += d.toString();
});
child.stdout.on("data", (d) => {
  out += d.toString();
});
child.on("close", (code) => {
  console.log("exit", code);
  // We expect this may fail auth/network, but NOT "unrecognized subcommand 'repo'"
  if (err.includes("unrecognized subcommand")) {
    console.error("FAIL: argv was split:", err.slice(0, 500));
    process.exit(1);
  }
  console.log("stderr head:", err.slice(0, 300).replace(/\n/g, " | "));
  console.log("stdout head:", out.slice(0, 200).replace(/\n/g, " | "));
  console.log("OK: no subcommand-split error");
});
child.on("error", (e) => {
  console.error("spawn error", e);
  process.exit(1);
});
