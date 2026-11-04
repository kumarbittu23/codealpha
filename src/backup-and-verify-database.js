const path = require("node:path");
const { spawnSync } = require("node:child_process");

function runScript(script, arguments_) {
  const result = spawnSync(process.execPath, [script, ...arguments_], {
    encoding: "utf8",
    env: process.env
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`Database procedure failed while running ${path.basename(script)}.`);
  return result.stdout;
}

try {
  if (process.argv.length > 3) {
    throw new Error("Usage: npm run backup:verify -- [destination-file]");
  }

  const destinationArgument = process.argv[2];
  const backupScript = path.join(__dirname, "backup-database.js");
  const restoreScript = path.join(__dirname, "restore-database.js");
  const backupOutput = runScript(backupScript, destinationArgument ? [destinationArgument] : []);
  const match = backupOutput.match(/Database backup created and verified: (.+)/);
  if (!match) throw new Error("Could not determine the generated backup path.");
  runScript(restoreScript, [match[1].trim()]);
  console.log("SQLite backup and restore verification completed successfully.");
} catch (error) {
  console.error(`Database backup and restore verification failed: ${error.message}`);
  process.exitCode = 1;
}
