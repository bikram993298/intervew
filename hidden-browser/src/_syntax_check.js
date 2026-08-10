// Temporary syntax-check script — safe to delete after Task 1 verification
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/ptm.js", "utf8");
// Replace browser globals with stubs so new Function() can parse the IIFE
const stubbed = src
  .replace(/"use strict";/, "")
  .replace(/\bdocument\.createElement\b/g, "(() => ({ style: {}, setAttribute() {}, src: '', partition: '' }))")
  .replace(/\bdocument\b/g, "({ createElement: () => ({ style: {}, setAttribute() {} }) })");
try {
  new Function(stubbed);
  console.log("ptm.js — Syntax OK");
} catch (e) {
  console.error("ptm.js — Syntax error:", e.message);
  process.exit(1);
}
