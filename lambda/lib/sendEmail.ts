import sendgrid from '@sendgrid/mail';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({
    region: process.env.AWS_REGION
});


// save the key outside the handler for caching
let API_KEY = '';

export const sendEmail = async (props: {to: string; subject: string; body: any })=> {

    const { to, subject, body } = props;

    if (!API_KEY) {
        const res = await ssm.send(new GetParameterCommand({
            Name: '/demo/sendgrid/apikey',
            WithDecryption: true
        }));
        API_KEY = res.Parameter?.Value as string;
        sendgrid.setApiKey(API_KEY);
    }

    return await sendgrid.send({
        to: {
            email: to
        },
        from: 'beef-support@vincelive.dev',
        replyTo: 'support@test-inbound-email.vincelive.dev',
        subject,
        text: typeof body === 'string' ? body : JSON.stringify(body)
    });

};