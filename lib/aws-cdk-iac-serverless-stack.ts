import * as cdk from 'aws-cdk-lib';
import { CfnOutput, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { SqsQueue, LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class AwsCdkIacServerlessStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const emailBucket = new Bucket(this, 'email-bucket', {
            bucketName: 'beef-support-emails-bucket',
        });

        const db = new Table(this, 'support-tickets', {
            billingMode: BillingMode.PAY_PER_REQUEST,
            tableName: 'beef-support-table',
            partitionKey: {
                name: 'pk',
                type: AttributeType.STRING
            },
            sortKey: {
                name: 'sk',
                type: AttributeType.STRING
            }
        });

        db.addGlobalSecondaryIndex({
            indexName: 'SkPkGSI',
            partitionKey: {
                name: 'sk',
                type: AttributeType.STRING
            },
            sortKey: {
                name: 'pk',
                type: AttributeType.STRING
            }
        });

        const eb = new EventBus(this, 'support-events', {
            eventBusName: 'support-bus'
        });

        const commentParserQueue = new Queue(this, 'comment-parser-queue', {
            queueName: 'comment-parser-queue',
            visibilityTimeout: Duration.minutes(10)
        });

        // The code that defines your stack goes here
        const inboundEmailFn = new NodejsFunction(this, 'inbound-email', {
            functionName: 'inbound-email',
            entry: 'lambda/inbound-email/src/index.ts',
            runtime: Runtime.NODEJS_20_X,
            environment: {
                EMAIL_BUCKET_NAME: emailBucket.bucketName,
                TABLE_NAME: db.tableName,
                EVENT_BUS: eb.eventBusName
            },
            timeout: Duration.minutes(1)
        });
        // grant permissions to write to s3
        emailBucket.grantPut(inboundEmailFn);
        // grant db write access
        db.grantWriteData(inboundEmailFn);
        // allow sending events to the event bus
        eb.grantPutEventsTo(inboundEmailFn);

        // The code that defines your stack goes here
        const apiProxyFn = new NodejsFunction(this, 'api-proxy', {
            functionName: 'api-proxy',
            entry: 'lambda/api-proxy/src/index.ts',
            runtime: Runtime.NODEJS_20_X,
            environment: {
                EMAIL_BUCKET_NAME: emailBucket.bucketName,
                TABLE_NAME: db.tableName,
                EVENT_BUS: eb.eventBusName
            },
            timeout: Duration.seconds(28)
        });
        // allow db read
        db.grantReadData(apiProxyFn);
        // allow comment.add to eventbridge
        eb.grantPutEventsTo(apiProxyFn);

        // the lambda that handles comment parsing and open ai augmentation
        const commentParserFn = new NodejsFunction(this, 'comment-parser', {
            functionName: 'comment-parser',
            entry: 'lambda/comment-parser/src/index.ts',
            runtime: Runtime.NODEJS_20_X,
            environment: {
                EMAIL_BUCKET_NAME: emailBucket.bucketName,
                TABLE_NAME: db.tableName,
                EVENT_BUS: eb.eventBusName
            },
            reservedConcurrentExecutions: 1,
            timeout: Duration.minutes(10)
        });
        // ensure slow processing to not hammer OpenAI
        commentParserFn.addEventSource(new SqsEventSource(commentParserQueue, {
            batchSize: 1
        }));

        // allow db
        db.grantReadData(commentParserFn);
        // allow sending to eventbridge
        eb.grantPutEventsTo(commentParserFn);
        // allow reading from s3
        emailBucket.grantRead(commentParserFn);
        // allow acessing SSM parameter for OpenAI API KEY
        commentParserFn.addToRolePolicy(new PolicyStatement({
            actions: ['ssm:GetParameter'],
            resources: ['arn:aws:ssm:eu-west-1:636545319327:parameter/demo/openai/apikey']
        }));

        // the lambda that handles comment writing to db
        const commentUpdaterFn = new NodejsFunction(this, 'comment-updater', {
            functionName: 'comment-updater',
            entry: 'lambda/comment-updater/src/index.ts',
            runtime: Runtime.NODEJS_20_X,
            environment: {
                EMAIL_BUCKET_NAME: emailBucket.bucketName,
                TABLE_NAME: db.tableName,
            }
        });
        // grant write to db
        db.grantWriteData(commentUpdaterFn);

        // the lambda that handles sending emails on comments
        const commentSenderFn = new NodejsFunction(this, 'comment-sender', {
            functionName: 'comment-sender',
            entry: 'lambda/comment-sender/src/index.ts',
            runtime: Runtime.NODEJS_20_X,
            environment: {
                EMAIL_BUCKET_NAME: emailBucket.bucketName,
                TABLE_NAME: db.tableName,
            },
            timeout: Duration.minutes(1)
        });
        // grant write to db
        db.grantReadData(commentSenderFn);
        // allow reading from s3
        emailBucket.grantRead(commentSenderFn);
        // grant ssm permissions to the api key
        commentSenderFn.addToRolePolicy(new PolicyStatement({
            actions: ['ssm:GetParameter'],
            resources: ['arn:aws:ssm:eu-west-1:636545319327:parameter/demo/sendgrid/apikey']
        }));

        // subscribe to requests for response generation
        new Rule(this, 'comment-sender-listener-rule', {
            eventBus: eb,
            ruleName: 'comment-sender-listener-rule',
            description: 'listens to comment.add events from external source',
            eventPattern: {
                // listen to all external events and relay them to the ticket creator
                // we don't want to send any internal comments
                source: [ { prefix: 'external.' } as unknown as any ],
                detailType: ['comment.add']
            },
            targets: [
                // go directly to the lambda here
                new LambdaFunction(commentSenderFn)
            ]
        });

        // subscribe to requests for response generation
        new Rule(this, 'comment-raw-listener-rule', {
            eventBus: eb,
            ruleName: 'response-generate-listener-rule',
            description: 'listens to response.generate events',
            eventPattern: {
                source: ['external.email'],
                detailType: ['response.generate']
            },
            targets: [
                new SqsQueue(commentParserQueue)
            ]
        });

        // subscribe to requests for creating comments in dynamodb
        new Rule(this, 'comment-add-listener-rule', {
            eventBus: eb,
            ruleName: 'comment-add-listener-rule',
            description: 'listens to comment.add events from ALL sources',
            eventPattern: {
                detailType: ['comment.add']
            },
            targets: [
                // go directly to the lambda here
                new LambdaFunction(commentUpdaterFn)
            ]
        });

        // create the api without cors restrictions
        const api = new HttpApi(this, 'api', {
            apiName: 'support-api',
            corsPreflight: {
                allowOrigins: ['*'],
                allowMethods: [CorsHttpMethod.ANY],
                allowHeaders: ['*'],
            },
        });

        // add a proxy route for the inbound email lambda
        api.addRoutes({
            path: '/v1/inbound-email',
            methods: [HttpMethod.POST],
            integration: new HttpLambdaIntegration('inbound-email', inboundEmailFn)
        });

        // add proxy route
        api.addRoutes({
            // Proxy route
            path: '/v1/{proxy+}',
            methods: [HttpMethod.ANY],
            integration: new HttpLambdaIntegration('api-proxy', apiProxyFn),
        });

        // add some outputs
        new CfnOutput(this, 'api-url', {
            value: api.apiEndpoint
        });


        // example resource
        // const queue = new sqs.Queue(this, 'AwsCdkIacServerlessQueue', {
        //   visibilityTimeout: cdk.Duration.seconds(300)
        // });
    }
}
