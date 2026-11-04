#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CornerStoreFoundationStack } from "../lib/corner-store-foundation-stack";

const app = new cdk.App();
const environmentName = app.node.tryGetContext("environment") || "development";
const supportedEnvironments = new Set(["development", "staging", "production"]);

if (!supportedEnvironments.has(environmentName)) {
  throw new Error("Set context environment to development, staging, or production.");
}

const natGatewayCount = Number(app.node.tryGetContext("natGateways") ?? (environmentName === "production" ? 2 : 0));
const accountDatabaseBackend = app.node.tryGetContext("accountDatabaseBackend") || "sqlite";
const postgresAccountCutover = app.node.tryGetContext("postgresAccountCutover") || "";
const postgresMarketplaceCutover = app.node.tryGetContext("postgresMarketplaceCutover") || "";
if (!["sqlite", "postgresql"].includes(accountDatabaseBackend)) throw new Error("accountDatabaseBackend must be sqlite or postgresql.");
if (!["", "complete"].includes(postgresAccountCutover) || !["", "complete"].includes(postgresMarketplaceCutover)) {
  throw new Error("PostgreSQL cutover values must be empty or complete.");
}
if (accountDatabaseBackend === "postgresql" && (postgresAccountCutover !== "complete" || postgresMarketplaceCutover !== "complete")) {
  throw new Error("PostgreSQL requires both marketplace cutover guards to be complete.");
}
if (!Number.isSafeInteger(natGatewayCount) || natGatewayCount < 0) {
  throw new Error("Context natGateways must be a non-negative whole number.");
}
if (environmentName === "production" && natGatewayCount < 2) {
  throw new Error("Production requires at least two NAT gateways for multi-AZ egress.");
}

new CornerStoreFoundationStack(app, `CornerStore-${environmentName}`, {
  env: { region: "ap-south-1" },
  environmentName,
  natGatewayCount,
  accountDatabaseBackend,
  postgresAccountCutover,
  postgresMarketplaceCutover
});
