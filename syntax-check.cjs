const fs = require("fs");
const filename = process.argv[2];
const code = fs.readFileSync(filename, "utf8");
try {
  // Check syntax by wrapping in a function
  new Function(code);
  console.log("SYNTAX_OK: " + filename);
} catch (e) {
  console.log("SYNTAX_ERROR: " + filename);
  console.log(e.message);
  console.log(e.stack);
  process.exit(1);
}
