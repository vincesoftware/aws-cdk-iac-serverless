import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { authorizer } from '../../lib/authorizer';

const ddb = new DynamoDBClient({
    region: process.env.AWS_REGION
});
const docClient = DynamoDBDocumentClient.from(ddb);

const eb = new EventBridgeClient({
    region: process.env.AWS_REGION
});


export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    console.log('event', event);

    const path = event.pathParameters?.proxy as string;
    const method = event.requestContext.http.method;

    if (method === 'OPTIONS') {
        return {
            statusCode: 200
        };
    }


    if (!path) {
        return {
            statusCode: 404
        };
    }

    if (method === 'GET' && path === 'ping') {
        return {
            statusCode: 200,
            body: 'pong'
        };
    }

    // authorize our requests
    if (!authorizer(event)) {
        return {
            statusCode: 403,
            body: 'oh god no, nevar'
        };
    }

    const statusCode = 200;
    let responseBody: any = {};

    const pathParts = path.split('/');

    // list all issues
    if (method === 'GET' && path === 'issues') {
        const results = await docClient.send(new QueryCommand({
            TableName: process.env.TABLE_NAME,
            IndexName: 'SkPkGSI',
            KeyConditionExpression: 'sk = :sk',
            ExpressionAttributeValues: {
                ':sk': 'HEADER'
            }
        }));

        responseBody = results.Items;

        // get single issue
    } else if (method === 'GET' && path.includes('issues/') && pathParts[1]) {
        const results = await docClient.send(new QueryCommand({
            TableName: process.env.TABLE_NAME,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: {
                ':pk': pathParts[1]
            }
        }));

        responseBody = results.Items;
    } else if (method === 'POST' && path.includes('issues/') && pathParts[1] && path.includes('/comments')) {
        const ticketId = pathParts[1];
        const { message, type, from } = JSON.parse(event.body as string);

        // check that ticket exists
        const results = await docClient.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: {
                pk: ticketId,
                sk: 'HEADER'
            }
        }));
        if (!results.Item) {
            return {
                statusCode: 404,
                body: 'Ticket does nto exist: ' + ticketId
            };
        }

        // send the comment to the service
        await eb.send(new PutEventsCommand({
            Entries: [{
                EventBusName: process.env.EVENT_BUS,
                Source: type ? `${type}.api` : 'external.api',
                DetailType: 'comment.add',
                Detail: JSON.stringify({
                    ticketId,
                    emailId: `${ticketId}.${new Date().getTime()}`, // emailId is not a good id here, but whatever
                    from,
                    message
                }),
            }]
        }));

        responseBody = undefined;
    } else {
        return {
            statusCode: 404,
            body: 'Route ' + path + ' does not exist'
        };
    }

    return {
        statusCode,
        body: responseBody ? JSON.stringify(responseBody) : undefined,
        headers: {
            'content-type': 'application/json'
        }
    };

};
