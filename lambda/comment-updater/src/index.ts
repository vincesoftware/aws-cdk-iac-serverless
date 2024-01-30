import { APIGatewayProxyStructuredResultV2, EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddb = new DynamoDBClient({
    region: process.env.AWS_REGION
});
const docClient = DynamoDBDocumentClient.from(ddb);


export const handler = async (event: EventBridgeEvent<string, {
    ticketId: string;
    emailId: string;
    from: string;
    message: string;
}>): Promise<APIGatewayProxyStructuredResultV2> => {
    console.log('event', event);

    const payload = event.detail;

    // add comment to dynamodb

    await docClient.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: {
            pk: payload.ticketId,
            sk: 'COMMENT#' + payload.emailId,
            from: payload.from,
            message: payload.message,
            type: event.source.includes('internal') ? 'internal' : 'external',
            lastUpdated: new Date().toISOString()
        }
    }));

    // update the existing DB record with new status and last updated time
    await docClient.send(new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: {
            pk: payload.ticketId,
            sk: 'HEADER'
        },
        UpdateExpression: 'set #status = :status, #lastUpdated = :lastUpdated',
        ExpressionAttributeNames: {
            '#status': 'status',
            '#lastUpdated': 'lastUpdated'
        },
        ExpressionAttributeValues: {
            ':status': payload.from.endsWith('@beef.support') ? 'BEEF_RESPONSE' : 'CUSTOMER_REQUEST',
            ':lastUpdated': new Date().toISOString()
        }
    }));

    return {
        statusCode: 200
    };

};