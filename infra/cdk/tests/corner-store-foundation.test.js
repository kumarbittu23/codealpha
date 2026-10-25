const assert = require("node:assert/strict");
const test = require("node:test");
const cdk = require("aws-cdk-lib");
const { Template, Match } = require("aws-cdk-lib/assertions");
const { CornerStoreFoundationStack } = require("../dist/lib/corner-store-foundation-stack");

test("foundation provisions private encrypted database, private media, and resilient queue policy", () => {
  const app = new cdk.App();
  const stack = new CornerStoreFoundationStack(app, "TestFoundation", {
    env: { region: "ap-south-1", account: "111111111111" },
    environmentName: "production",
    natGatewayCount: 2
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs("AWS::RDS::DBInstance", 1);
  template.hasResourceProperties("AWS::RDS::DBInstance", {
    PubliclyAccessible: false,
    MultiAZ: true,
    StorageEncrypted: true,
    DeletionProtection: true,
    BackupRetentionPeriod: 35
  });
  template.hasResourceProperties("AWS::S3::Bucket", {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true
    },
    VersioningConfiguration: { Status: "Enabled" }
  });
  template.hasResourceProperties("AWS::SQS::Queue", {
    SqsManagedSseEnabled: true
  });
  template.hasResourceProperties("AWS::ECS::Cluster", {
    ClusterSettings: Match.arrayWith([
    Match.objectLike({ Name: "containerInsights", Value: "enabled" })
    ])
  });
  template.resourceCountIs("AWS::ECR::Repository", 12);
});
