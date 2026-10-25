# AWS CDK foundation

This directory defines an **un-deployed infrastructure foundation** for the marketplace target in `../../ARCHITECTURE.md`. Synthesizing templates is local and does not create AWS resources. Do not run `cdk deploy` until the account owner approves a written cost ceiling and has reviewed the synthesized change set.

## What this stack defines

- A two-Availability-Zone VPC with public, application, and isolated database subnets.
- A PostgreSQL 16 RDS instance, generated database credentials in Secrets Manager, encrypted storage, private ingress, and backups. Production context enables Multi-AZ, deletion protection, and a retained database.
- A private, versioned, encrypted S3 media bucket.
- An encrypted SQS marketplace event queue with a dead-letter queue.
- An ECS cluster and one immutable, scan-on-push ECR image repository for each proposed service.
- No ECS services, task definitions, public load balancer, CloudFront distribution, WAF, Redis cluster, OpenSearch cluster, payment integration, or email/SMS/carrier configuration. Those require service images, provider selections, security review, scaling/cost decisions, and additional implementation.

The first Postgres database is a **migration bridge**, not a final design for the selected microservices architecture. Before services use production data, give each service database and credentials it owns; never let one service directly write another service's tables. The old SQLite app has not been switched to this database.

An offline, tested migration rehearsal from the existing SQLite schema into a disposable PostgreSQL database is documented in the root `README.md`. It does not require or create AWS infrastructure. The app still uses SQLite and must not be pointed at this RDS schema until its repository/database adapter is implemented and tested.

## Local checks only

Requires Node.js 22 or later and npm. From this directory:

```powershell
npm ci
npm test
npm run synth -- --quiet
```

Review the rendered templates under `cdk.out/` (ignored by Git). The default development stack in `ap-south-1` has no NAT gateways to avoid provisioning default monthly NAT charges; it cannot reach external payment APIs from private compute. Production context requires at least two NAT gateways for multi-AZ egress and is therefore substantially more expensive. Set a hard AWS Budget/alert and review current regional prices before any deployment; AWS Budgets alerting does not automatically cap all charges.

Synthesis examples:

```powershell
npm run synth
npm run synth -- --quiet -c environment=staging -c natGateways=1
npm run synth -- --quiet -c environment=production -c natGateways=2
```

These commands only synthesize. They do not deploy or need AWS credentials. `cdk bootstrap` and `cdk deploy` create resources and may incur charges; do not run them until deployment is explicitly authorized.
