import * as cdk from '@aws-cdk/core';
import * as cr from '@aws-cdk/custom-resources';
import * as iam from '@aws-cdk/aws-iam';
import * as logs from '@aws-cdk/aws-logs';
import * as lambda from '@aws-cdk/aws-lambda';
import {join} from "path";
import {CfnOutput} from "@aws-cdk/core";

export interface RdsStatementRunnerProps {
    readonly dbArn: string;
    readonly databaseName: string;
    readonly secretArn: string;
    readonly statements: string[];
}

export class RdsStatementRunner extends cdk.Construct {
    constructor(scope: cdk.Construct, id: string, props: RdsStatementRunnerProps) {
        super(scope, id);

        const role = new iam.Role(this, `rds-statement-runner-role-${id}`, {
            roleName: `rds-statement-runner-role-${id}`,
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonRDSDataFullAccess"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")
            ],
            inlinePolicies: {
                "secret-access": new iam.PolicyDocument({
                    statements: [new iam.PolicyStatement({
                        effect: iam.Effect.ALLOW,
                        actions: [
                            "secretsmanager:GetSecretValue",
                            "secretsmanager:PutResourcePolicy",
                            "secretsmanager:PutSecretValue",
                            "secretsmanager:DeleteSecret",
                            "secretsmanager:DescribeSecret",
                            "secretsmanager:TagResource"
                        ],
                        resources: [props.secretArn]
                    })
                    ]
                })
            }
        })

        const runner = new lambda.Function(this, `rds-statement-runner-lambda-${id}`, {
            functionName: `rds-statement-runner-lambda-${id}`,
            code: new lambda.AssetCode(join(__dirname, "../build/rds-statement-runner.zip")),
            role: role,
            handler: "rds-statement-runner",
            runtime: lambda.Runtime.GO_1_X,
            environment: {
                "DB_ARN": props.dbArn,
                "SECRET_ARN": props.secretArn,
                "DATABASE_NAME": props.databaseName,
            }
        })
        for (const index in props.statements) {
            const name = "STATEMENT_" + index
            const statement = props.statements[index]
            runner.addEnvironment(name, statement)
        }

        const provider = new cr.Provider(this, `rds-statement-runner-provider-${id}`, {
            onEventHandler: runner,
            logRetention: logs.RetentionDays.ONE_DAY
        })
        const resource = new cdk.CustomResource(this, `rds-statement-runner-resource-${id}`, {
            serviceToken: provider.serviceToken
        })
        resource.node.addDependency(runner)

        new CfnOutput(this, 'test-query', {
            exportName: 'test-query',
            value: `aws rds-data execute-statement --resource-arn "${props.dbArn}" --database "${props.databaseName}" --secret-arn "${props.secretArn}" --sql "select * from Events"`
        })
    }
}