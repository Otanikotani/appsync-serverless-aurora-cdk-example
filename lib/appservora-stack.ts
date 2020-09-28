import {App, CfnOutput, Stack, StackProps} from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as secretsmanager from "@aws-cdk/aws-secretsmanager";
import * as appsync from "@aws-cdk/aws-appsync";
import * as iam from "@aws-cdk/aws-iam";
import * as rds from "@aws-cdk/aws-rds";
import {join} from "path";
import {RdsStatementRunner} from "./rds-statement-runner";


interface AppServOraStackProps extends StackProps {
}

export class AppServOraStack extends Stack {
    constructor(scope: App, id: string, props: AppServOraStackProps) {
        super(scope, id, props);

        const vpc = new ec2.Vpc(this, `vpc`, {
            cidr: '10.0.0.0/16',
        })

        const dbCreds = new secretsmanager.Secret(this, `aurora-creds`, {
            secretName: `aurora-creds`,
            generateSecretString: {
                secretStringTemplate: '{"username": "admin"}',
                generateStringKey: 'password',
                passwordLength: 16,
                excludeCharacters: '"@/\\'
            }
        })

        new CfnOutput(this, 'secret-arn', {
            exportName: 'secret-arn',
            value: dbCreds.secretArn
        })

        const auroraSg = new ec2.SecurityGroup(this, 'aurora-security-group', {
            securityGroupName: 'aurora-security-group',
            vpc: vpc
        })

        const defaultDatabaseName = 'sample_db'
        //https://github.com/aws/aws-cdk/issues/929#issuecomment-644850341
        const aurora = new rds.DatabaseCluster(this, "aurora-cluster", {
            clusterIdentifier: "aurora-cluster",
            engine: rds.DatabaseClusterEngine.auroraMysql({version: rds.AuroraMysqlEngineVersion.VER_2_08_1}),
            masterUser: {
                username: dbCreds.secretValueFromJson('username').toString(),
                password: dbCreds.secretValueFromJson('password')
            },
            defaultDatabaseName: defaultDatabaseName,
            instanceProps: {
                instanceType: new ec2.InstanceType('t3.small'),
                vpc: vpc,
                securityGroups: [auroraSg],

            },
            instances: 1,
        })
        const cfn_aurora_cluster = (aurora.node.defaultChild as rds.CfnDBCluster);

        cfn_aurora_cluster.addPropertyOverride("EngineMode", "serverless")
        cfn_aurora_cluster.addPropertyOverride("EnableHttpEndpoint", true)
        cfn_aurora_cluster.addPropertyOverride("ScalingConfiguration", {
            'AutoPause': true,
            'MaxCapacity': 2,
            'MinCapacity': 1,
            'SecondsUntilAutoPause': 600
        })
        aurora.node.tryRemoveChild('Instance1');

        const dbArn = `arn:aws:rds:${this.region}:${this.account}:cluster:${aurora.clusterIdentifier}`

        new CfnOutput(this, 'db-arn', {
            exportName: 'db-arn',
            value: dbArn
        })

        // Nifty trick to load some data into the database at deploy
        new RdsStatementRunner(this, `rds-statement-runner`, {
            secretArn: dbCreds.secretArn,
            databaseName: defaultDatabaseName,
            dbArn: dbArn,
            statements: [
                    `CREATE TABLE Events
                     (
                         id          INT,
                         name        VARCHAR(255),
                         location    VARCHAR(255),
                         at          DATE,
                         description VARCHAR(255)
                     )`,

                    `INSERT INTO Events (id, name, location, at, description)
                     VALUES (1, 'First ever', '0.0;0.0', DATE('2017-04-04 01:01:01'), 'It is still happening!')`
            ]
        })

        new CfnOutput(this, 'test-query', {
            exportName: 'test-query',
            value: `aws rds-data execute-statement --resource-arn "${dbArn}" --database "${defaultDatabaseName}" --secret-arn "${dbCreds.secretArn}" --sql "select * from Events"`
        })

        const coapi = new appsync.GraphqlApi(this, `aurora-graphql`, {
            name: `aurora-graphql`,
            schema: appsync.Schema.fromAsset(join(__dirname, 'schema.graphql')),
            authorizationConfig: {
                defaultAuthorization: {
                    authorizationType: appsync.AuthorizationType.IAM
                },
            },
        });

        new CfnOutput(this, 'api-id', {
            exportName: 'api-id',
            value: coapi.apiId
        })

        const appsyncServiceRole = new iam.Role(this, `appsync-service-role`, {
            roleName: `appsync-service-role`,
            assumedBy: new iam.ServicePrincipal("appsync.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSAppSyncPushToCloudWatchLogs")
            ],
            inlinePolicies: {
                "access-rds": new iam.PolicyDocument({
                    statements: [new iam.PolicyStatement({
                        effect: iam.Effect.ALLOW,
                        actions: ['rds:*', 'rds-data:*'],
                        resources: [dbArn]
                    }), new iam.PolicyStatement({
                        effect: iam.Effect.ALLOW,
                        actions: ['secretsmanager:*'],
                        resources: [dbCreds.secretArn]
                    })]
                })
            }
        })

        const appsyncDataSource = new appsync.CfnDataSource(this, `appsync-aurora-ds`, {
            apiId: coapi.apiId,
            type: "RELATIONAL_DATABASE",
            name: `aurora_ds`,
            relationalDatabaseConfig: {
                relationalDatabaseSourceType: "RDS_HTTP_ENDPOINT",
                rdsHttpEndpointConfig: {
                    awsRegion: 'us-east-1',
                    awsSecretStoreArn: dbCreds.secretArn,
                    databaseName: defaultDatabaseName,
                    dbClusterIdentifier: dbArn
                }
            },
            serviceRoleArn: appsyncServiceRole.roleArn
        })

        const listEventsResolver = new appsync.CfnResolver(this, `list-event-resolver`, {
            apiId: coapi.apiId,
            fieldName: "listEvents",
            typeName: "Query",
            requestMappingTemplate: `{
                "version": "2018-05-29",
                "statements": [
                    "select * from Events"
                ]
            }`,
            responseMappingTemplate: `
            #if($ctx.error)
                $utils.error($ctx.error.message, $ctx.error.type)
            #end

            $utils.toJson($utils.rds.toJsonObject($ctx.result)[0])`,
            dataSourceName: appsyncDataSource.name
        })

        listEventsResolver.addDependsOn(appsyncDataSource);
    }
}
