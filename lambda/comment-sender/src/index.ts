import { APIGatewayProxyStructuredResultV2, EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { sendEmail } from '../../lib/sendEmail';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { simpleParser } from 'mailparser';

const ddb = new DynamoDBClient({
    region: process.env.AWS_REGION
});
const docClient = DynamoDBDocumentClient.from(ddb);

const s3 = new S3Client({
    region: process.env.AWS_REGION
});

export const handler = async (event: EventBridgeEvent<string, {
    ticketId: string;
    emailId: string;
    from: string;
    message: string;
}>): Promise<APIGatewayProxyStructuredResultV2> => {
    console.log('event', event);

    const payload = event.detail;

    // get the header record from dynamodb
    const headerRes = await docClient.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: {
            pk: payload.ticketId,
            sk: 'HEADER',
        }
    }));

    const header = headerRes.Item!;

    const subject = header?.subject?.startsWith('Re:') ? header.subject : 'Re: ' + header.subject;

    const body = header!.status === 'NEW'
        ? 'Your ticket has been created! Someone will attack you shortly!\n\nOriginal message:\n\n' + payload.message
        : `A new comment was added on your ticket by ${payload.from}:\n\n${payload.message}`;

    // send the response to the creator + the
    await sendEmail({
        to: header!.createdBy,
        subject,
        body
    });


    return {
        statusCode: 200
    };

};