import { Readable } from 'stream';
import ShortUniqueId from 'short-unique-id';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Busboy = require('busboy');

export async function parseFormdata(contentType: string, decodedBodyString: string): Promise<any> {
    const data: any = {};
    const readableStream = Readable.from(decodedBodyString);

    const busboy = Busboy({ headers: { 'content-type': contentType } });

    return new Promise((resolve, reject) => {
        busboy.on('field', async function(fieldname: string, val: string) {
            data[fieldname] = val;
        });

        busboy.on('finish', function() {
            console.log('Done parsing form!');
            resolve(data);
        });

        busboy.on('error', function(error: any) {
            console.log('Error parsing form: ', error);
            reject(error);
        });

        readableStream.pipe(busboy);
    });
}

export function getAttachments(parsedEmail: Record<string, any>) {
    const attachments: Record<string, any> = {};

    if (parsedEmail.attachments) {
        parsedEmail.attachments.forEach((attachment: any) => {
            if (attachment.cid) {
                // Convert image buffer to base64
                attachments[attachment.cid] = attachment.content.toString('base64');
            }
        });
    }
    return attachments;
}

export function getLatestMessage(parsedEmail: Record<string, any>): {
    raw: string;
    parts: {  type: 'text' | 'attachment' | 'link', value: 'string', id?: string }[]
} {
    const attachments = getAttachments(parsedEmail);
    const textParts = parsedEmail.text.split('________________________________\n');
    const latestMessage = textParts[0]; // Latest message is the first part

    const resultArray = [];
    let match;
    const regexp = /\[(.*?)\]|([^[]+)/g;

    while ((match = regexp.exec(latestMessage)) != null) {
        const fullMatch = match[0];
        const bracketContent = match[1];
        const text = match[2];

        if (text && text.trim().length > 0) {
            resultArray.push({
                type: 'text',
                value: text.trim(),
            });
        }

        if (bracketContent) {
            if (bracketContent.startsWith('cid:')) {
                const cid = bracketContent.substr(4);
                if (attachments[cid]) {
                    resultArray.push({
                        type: 'attachment',
                        value: attachments[cid],
                        id: cid
                    });
                }
            } else if (bracketContent.startsWith('https:')) {
                resultArray.push({
                    type: 'link',
                    value: bracketContent,
                });
            }
        }
    }

    return {
        raw: latestMessage,
        parts: resultArray as any
    };
}


export function generateId(length = 8) {

    const uid = new ShortUniqueId({ length: 8 });
    return uid.rnd();
}

export function identifyId(subject: string): string | null {
    const pattern = /\[BEEF:([\w\d]+)\]/;

    const match = subject.match(pattern);
    let ticketId = null;

    if (match) {
        ticketId = match[1];  // The first capture group contains the ticket ID
    }
    return ticketId;
}
