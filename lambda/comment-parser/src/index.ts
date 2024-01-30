import { APIGatewayProxyStructuredResultV2, SQSEvent } from 'aws-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { simpleParser } from 'mailparser';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import axios from 'axios';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getLatestMessage } from '../../lib/email-helpers';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const s3 = new S3Client({
    region: process.env.AWS_REGION
});

const ssm = new SSMClient({
    region: process.env.AWS_REGION
});


const eb = new EventBridgeClient({
    region: process.env.AWS_REGION
});

const ddb = new DynamoDBClient({
    region: process.env.AWS_REGION
});
const docClient = DynamoDBDocumentClient.from(ddb);


// save the key outside the handler for caching
let API_KEY = '';

export const handler = async (event: SQSEvent): Promise<APIGatewayProxyStructuredResultV2> => {
    console.log('event', event);

    // extract the payload
    const payload = JSON.parse(event.Records[0].body);
    console.log('payload', payload);

    const { emailId, ticketId } = payload.detail;

    // now get the email data from S3
    const obj = await s3.send(new GetObjectCommand({
        Bucket: process.env.EMAIL_BUCKET_NAME,
        Key: `${emailId}.json`
    }));
    // convert the binary to string
    const raw = await obj.Body?.transformToString('utf-8');
    const rawJson = JSON.parse(raw as string);

    // parse the email content
    const parsedEmail = await simpleParser(rawJson.email);
    // extract last message
    const latestMessage = getLatestMessage(parsedEmail);

    console.log('latestMessage', latestMessage);

    // now prepare the openai calls
    if (!API_KEY) {
        const res = await ssm.send(new GetParameterCommand({
            Name: '/demo/openai/apikey',
            WithDecryption: true
        }));
        API_KEY = res.Parameter?.Value as string;
    }

    // load history
    const results = await docClient.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'pk = :pk and begins_with(sk, :sk)',
        ExpressionAttributeValues: {
            ':pk': ticketId,
            ':sk': 'COMMENT#'
        }
    }));

    // do we have any images
    const hasImages = latestMessage.parts.some(x => x.type === 'attachment');
    const model = hasImages ? 'gpt-4-vision-preview' : 'gpt-4-turbo-preview';
    const requestBody = {
        model,
        messages: [
            {
                role: 'system',
                content: [{
                    type: 'text',
                    text: `You are a support ticket bot.
                        You are snarky and you always know better than the user, 
                        and you are not afraid to point out weaknesses in the users input or logic.
                        You have a beef with the user, but you are not mean, 
                        and you do actually try to solve the issue while being a bit cocky.
                        Try to respond with short sarcastic sentences.
                        If you get any questions about food, always respond with something related to fish. Meat sucks.
                        `
                }]
            },
            // merge history
            ...(results.Items ?? []).slice(0, results.Count! - 1).map(comment => {
                return {
                    role: comment.from === 'beefy@beef.support' ? 'assistant' : 'user',
                    content: [{
                        type: 'text',
                        text: comment.message
                    }]
                };
            }),
            // merge the latest message as USER inputs
            ...latestMessage.parts
                .filter(part => ['text', 'attachment'].includes(part.type))
                .map(part => {
                    if (part.type === 'text') {
                        return {
                            role: 'user',
                            content: [{
                                type: 'text',
                                text: part.value
                            }]
                        };
                    } else {
                        // images needs a different structure
                        return {
                            role: 'user',
                            content: [{
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/png;base64,${part.value}`
                                }
                            }]
                        };
                    }
                })
        ],
        // default params from openai playground
        'temperature': 1,
        'max_tokens': 1000,
        'top_p': 1,
        'frequency_penalty': 0,
        'presence_penalty': 0
        
    };


    console.log(JSON.stringify(requestBody, null, 2));

    // call the api
    try {
        const res = await axios.post('https://api.openai.com//v1/chat/completions', requestBody, {
            headers: {
                authorization: 'Bearer ' + API_KEY
            }
        });

        //now extract the response
        const message = res.data.choices[0].message.content;

        // send the response to the comment service
        await eb.send(new PutEventsCommand({
            Entries: [{
                EventBusName: process.env.EVENT_BUS,
                Source: 'external.ai',
                DetailType: 'comment.add',
                Detail: JSON.stringify({
                    ticketId,
                    emailId: `${ticketId}.${new Date().getTime()}`, // emailId is not a good id here, but whatever
                    from: 'beefy@beef.support',
                    message: message
                }),
            }]
        }));

    } catch (error: any) {
        console.error(`Error occurred: ${error}`);
        if (error.response) {
            console.error(`Response Body: ${error.response.data}`);
            console.log(JSON.stringify(error.response.data, null, 2));
        }
    }

    return {
        statusCode: 200,
    };
};