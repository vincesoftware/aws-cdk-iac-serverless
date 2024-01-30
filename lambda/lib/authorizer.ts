import { APIGatewayProxyEventV2 } from 'aws-lambda';


export const authorizer = (event: APIGatewayProxyEventV2): any => {
    return event.headers.authorization === 'Bearer uhimmuhimuhmuihmi0gmih0hmui';

};