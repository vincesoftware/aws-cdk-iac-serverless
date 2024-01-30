import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { simpleParser } from 'mailparser';
import { generateId, getLatestMessage, identifyId, parseFormdata } from '../../lib/email-helpers';

const s3 = new S3Client({
    region: process.env.AWS_REGION
});

const eb = new EventBridgeClient({
    region: process.env.AWS_REGION
});

const ddb = new DynamoDBClient({
    region: process.env.AWS_REGION
});
const docClient = DynamoDBDocumentClient.from(ddb);

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    console.log('event', event);

    const token = event.queryStringParameters?.token;


    if (token !== '6ab2f5c2-32e4-42af-ae62-a0ae9b4c1715') {
        return {
            statusCode: 403,
            body: 'Forbidden'
        };
    }


    if (event.isBase64Encoded) {
        // Decode the base64-encoded body
        const decodedBody = Buffer.from(event.body as string, 'base64').toString('utf-8');

        const rawParsed = await parseFormdata(event.headers['content-type'] as string, decodedBody);

        // try to find a support ticket ID in the email or generate an ID if not found
        let isNewTicket = true;
        let ticketId = identifyId(rawParsed.subject);
        if (ticketId) {
            isNewTicket = false;
        } else {
            ticketId = generateId();
        }

        // save the contents to S3, use timestamp for this conversation
        const emailId = `${ticketId}.${new Date().getTime()}`;
        await s3.send(new PutObjectCommand({
            Bucket: process.env.EMAIL_BUCKET_NAME,
            Body: JSON.stringify(rawParsed),
            Key: `${emailId}.json`
        }));

        // parse the email
        const parsedEmail = await simpleParser(rawParsed.email);
        const from = parsedEmail.from?.value?.[0]?.address ?? 'unknown';
        
        // get the latest message and save any attachments using their id
        const latestMessage = getLatestMessage(parsedEmail);
        for (const x of latestMessage.parts.filter(x => x.type === 'attachment')) {
            await s3.send(new PutObjectCommand({
                Bucket: process.env.EMAIL_BUCKET_NAME,
                Body: JSON.stringify(rawParsed),
                Key: `${x.id}.png`
            }));
        }

        // if it's a new ticket, create the DB record
        if (isNewTicket) {
            await docClient.send(new PutCommand({
                TableName: process.env.TABLE_NAME,
                Item: {
                    pk: ticketId,
                    sk: 'HEADER',
                    createdBy: from,
                    subject: rawParsed.subject + ` [BEEF:${ticketId}]`,
                    status: 'NEW',
                    lastUpdated: new Date().toISOString(),
                    originalId: emailId
                }
            }));
        } else {
            // update the existing DB record with new status and last updated time
            await docClient.send(new UpdateCommand({
                TableName: process.env.TABLE_NAME,
                Key: {
                    pk: ticketId,
                    sk: 'HEADER'
                },
                UpdateExpression: 'set #status = :status, #lastUpdated = :lastUpdated',
                ExpressionAttributeNames: {
                    '#status': 'status',
                    '#lastUpdated': 'lastUpdated'
                },
                ExpressionAttributeValues: {
                    ':status': 'CUSTOMER_RESPONSE',
                    ':lastUpdated': new Date().toISOString()
                }
            }));
        }
        // now send the raw comment to the comment add service
        await eb.send(new PutEventsCommand({
            Entries: [{
                EventBusName: process.env.EVENT_BUS,
                Source: 'external.email',
                DetailType: 'comment.add',
                Detail: JSON.stringify({
                    ticketId,
                    emailId,
                    from,
                    message: latestMessage.raw
                }),
            }]
        }));
        // now send this message for processing
        await eb.send(new PutEventsCommand({
            Entries: [{
                EventBusName: process.env.EVENT_BUS,
                Source: 'external.email',
                DetailType: 'response.generate',
                Detail: JSON.stringify({
                    ticketId,
                    emailId
                }),
            }]
        }));

    }

    return {
        statusCode: 200,
        headers: {
            'content-type': 'application/json'
        }
    };
};