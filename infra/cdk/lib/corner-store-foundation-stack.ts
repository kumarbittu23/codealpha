import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

interface CornerStoreFoundationStackProps extends StackProps {
  environmentName: "development" | "staging" | "production";
  natGatewayCount: number;
}

const serviceNames = [
  "identity",
  "catalog",
  "search",
  "pricing",
  "cart",
  "inventory",
  "orders",
  "payments",
  "sellers",
  "shipping",
  "returns",
  "recommendations"
];

export class CornerStoreFoundationStack extends Stack {
  constructor(scope: Construct, id: string, props: CornerStoreFoundationStackProps) {
    super(scope, id, props);

    const isProduction = props.environmentName === "production";
    const vpc = new ec2.Vpc(this, "ApplicationVpc", {
      maxAzs: 2,
      natGateways: props.natGatewayCount,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: "application",
          subnetType: props.natGatewayCount > 0
            ? ec2.SubnetType.PRIVATE_WITH_EGRESS
            : ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 20
        },
        { name: "database", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }
      ]
    });

    vpc.addGatewayEndpoint("S3GatewayEndpoint", {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [
        {
          subnetType: props.natGatewayCount > 0
            ? ec2.SubnetType.PRIVATE_WITH_EGRESS
            : ec2.SubnetType.PRIVATE_ISOLATED
        }
      ]
    });
    const backendSecurityGroup = new ec2.SecurityGroup(this, "BackendSecurityGroup", {
      vpc,
      description: "Attach only to reviewed private backend ECS task definitions",
      allowAllOutbound: true
    });
    const databaseSecurityGroup = new ec2.SecurityGroup(this, "DatabaseSecurityGroup", {
      vpc,
      description: "PostgreSQL ingress is restricted to private application tasks",
      allowAllOutbound: false
    });
    const cluster = new ecs.Cluster(this, "ApplicationCluster", {
      vpc,
      clusterName: `corner-store-${props.environmentName}`,
      containerInsightsV2: ecs.ContainerInsights.ENABLED
    });

    const databaseCredentials = rds.Credentials.fromGeneratedSecret("corner_admin", {
      secretName: `corner-store/${props.environmentName}/postgres`
    });
    const database = new rds.DatabaseInstance(this, "PlatformDatabase", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16
      }),
      instanceType: isProduction
        ? ec2.InstanceType.of(ec2.InstanceClass.M7G, ec2.InstanceSize.LARGE)
        : ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      credentials: databaseCredentials,
      databaseName: "corner_store",
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      multiAz: isProduction,
      storageEncrypted: true,
      allocatedStorage: 50,
      maxAllocatedStorage: 200,
      backupRetention: isProduction ? Duration.days(35) : Duration.days(7),
      deletionProtection: isProduction,
      publiclyAccessible: false,
      autoMinorVersionUpgrade: true,
      cloudwatchLogsExports: ["postgresql", "upgrade"],
      cloudwatchLogsRetention: isProduction
        ? cdk.aws_logs.RetentionDays.ONE_MONTH
        : cdk.aws_logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.SNAPSHOT
    });
    database.connections.allowDefaultPortFrom(backendSecurityGroup);

    const productMedia = new s3.Bucket(this, "ProductMediaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      minimumTLSVersion: 1.2,
      lifecycleRules: [{
        noncurrentVersionExpiration: Duration.days(isProduction ? 90 : 30)
      }],
      removalPolicy: RemovalPolicy.RETAIN
    });

    const deadLetterQueue = new sqs.Queue(this, "MarketplaceDeadLetterQueue", {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
      removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });
    const marketplaceEvents = new sqs.Queue(this, "MarketplaceEventsQueue", {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: Duration.seconds(120),
      retentionPeriod: Duration.days(4),
      removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 5
      }
    });

    const repositories = serviceNames.map((serviceName) =>
      new ecr.Repository(this, `${serviceName}ImageRepository`, {
        repositoryName: `corner-store/${serviceName}`,
        imageScanOnPush: true,
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        lifecycleRules: [{
          description: "Retain a bounded set of recent deployment images",
          maxImageCount: isProduction ? 50 : 10
        }],
        removalPolicy: RemovalPolicy.RETAIN
      })
    );

    new cdk.CfnOutput(this, "VpcId", { value: vpc.vpcId });
    new cdk.CfnOutput(this, "EcsClusterName", { value: cluster.clusterName });
    new cdk.CfnOutput(this, "DatabaseSecretArn", {
      value: database.secret?.secretArn ?? "Unavailable"
    });
    new cdk.CfnOutput(this, "DatabaseEndpoint", {
      value: database.instanceEndpoint.hostname
    });
    new cdk.CfnOutput(this, "ProductMediaBucketName", {
      value: productMedia.bucketName
    });
    new cdk.CfnOutput(this, "MarketplaceEventsQueueUrl", {
      value: marketplaceEvents.queueUrl
    });
    new cdk.CfnOutput(this, "MarketplaceDeadLetterQueueUrl", {
      value: deadLetterQueue.queueUrl
    });
    new cdk.CfnOutput(this, "EcrRepositoryNames", {
      value: repositories.map((repository) => repository.repositoryName).join(",")
    });
    new cdk.CfnOutput(this, "BackendSecurityGroupId", {
      value: backendSecurityGroup.securityGroupId
    });
  }
}
