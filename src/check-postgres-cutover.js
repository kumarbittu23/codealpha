const { inspectMarketplaceCutover } = require("./config/postgres-marketplace-cutover");

const inspection = inspectMarketplaceCutover();
console.log("PostgreSQL marketplace repository cutover:");
for (const repository of inspection.required) {
  console.log(`  ${repository.area}: ${repository.present ? "ready" : "missing"}`);
}
if (!inspection.ready) {
  console.error("PostgreSQL runtime cutover remains blocked until every marketplace repository is implemented and tested.");
  process.exitCode = 1;
}
