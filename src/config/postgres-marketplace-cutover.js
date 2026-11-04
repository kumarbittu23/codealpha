const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.join(__dirname, "..", "repositories");
const requiredPostgresRepositories = [
  ["users", "postgres-users.repository.js"],
  ["account", "postgres-account.repository.js"],
  ["catalog", "postgres-catalog.repository.js"],
  ["seller", "postgres-seller.repository.js"],
  ["orders", "postgres-orders.repository.js"],
  ["reviews", "postgres-reviews.repository.js"],
  ["admin", "postgres-admin.repository.js"]
];

function inspectMarketplaceCutover() {
  const missing = requiredPostgresRepositories
    .filter(([, filename]) => !fs.existsSync(path.join(repositoryRoot, filename)))
    .map(([area, filename]) => ({ area, filename }));
  return {
    ready: missing.length === 0,
    required: requiredPostgresRepositories.map(([area, filename]) => ({ area, filename, present: fs.existsSync(path.join(repositoryRoot, filename)) })),
    missing
  };
}

function requireMarketplaceRepositoriesCutover() {
  const inspection = inspectMarketplaceCutover();
  if (!inspection.ready) {
    throw new Error(`PostgreSQL marketplace repositories are incomplete: ${inspection.missing.map((item) => item.area).join(", ")}.`);
  }
  return inspection;
}

module.exports = { inspectMarketplaceCutover, requireMarketplaceRepositoriesCutover };
