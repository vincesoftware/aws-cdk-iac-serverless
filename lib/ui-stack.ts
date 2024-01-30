import * as cdk from 'aws-cdk-lib';
import { CloudFrontWebDistribution, Distribution, OriginAccessIdentity } from 'aws-cdk-lib/aws-cloudfront';
import { Bucket, BucketAccessControl } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { CfnOutput } from 'aws-cdk-lib';

export class UiStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Define a new S3 bucket to hold your website content
        const websiteBucket = new Bucket(this, 'WebsiteBucket', {
            bucketName: 'beef-support-ui-bucket',
            accessControl: BucketAccessControl.PRIVATE,
        });

        // define origin access identity, to ensure that only requests from couldfront with this identity are allowed
        const originAccessIdentity = new OriginAccessIdentity(this, 'OriginAccessIdentity');
        websiteBucket.grantRead(originAccessIdentity);

        const distribution = new Distribution(this, 'Distribution', {
            defaultRootObject: 'index.html',
            defaultBehavior: {
                origin: new S3Origin(websiteBucket, { originAccessIdentity }),
            },
        });

        // Define a new S3 deployment to deploy your website content to the S3 bucket
        new BucketDeployment(this, 'DeployWebsite', {
            sources: [Source.asset('./web')],
            destinationBucket: websiteBucket,
            distribution: distribution, // Optional: Invalidate the CloudFront distribution when new files are added
            distributionPaths: ['/*'],  // Optional: Invalidate the specific paths in the CloudFront distribution when new files are added
        });

        // add some outputs
        new CfnOutput(this, 'cloudfront-domain', {
            value: distribution.domainName
        });
    }
}