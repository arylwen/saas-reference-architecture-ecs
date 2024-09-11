import { Duration } from 'aws-cdk-lib'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3notifications from 'aws-cdk-lib/aws-s3-notifications';
import * as s3deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { addTemplateTag } from '../utilities/helper-functions';

export interface LambdaStaticSiteProps {
  readonly name: string;
  readonly assetDirectory: string;
  readonly production: boolean;
  readonly clientId?: string;
  readonly issuer?: string;
  readonly apiUrl: string;
  readonly wellKnownEndpointUrl?: string;
  readonly defaultBranchName?: string;
  readonly distribution: cloudfront.Distribution;
  readonly appBucket: s3.Bucket;
  accessLogsBucket: s3.Bucket;
}

export class LambdaStaticSite extends Construct {
  constructor(scope: Construct, id: string, props: LambdaStaticSiteProps) {
    super(scope, id);
    addTemplateTag(this, 'LambdaStaticSite');

    // S3 bucket to hold updated code
    const sourceCodeBucket = new s3.Bucket(this, `${props.name}SourceCodeBucket`, {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
    });

    const siteConfig = {
      production: props.production,
      clientId: props.clientId,
      issuer: props.issuer,
      apiUrl: props.apiUrl,
      wellKnownEndpointUrl: props.wellKnownEndpointUrl,
    };

     // Lambda Layer containing the unzip command
     const unzipLayer = new lambda.LayerVersion(this, 'UnzipLayer', {
      code: lambda.Code.fromAsset('lib/bootstrap-template/unzip-layer.zip'),  // Update this path to your zipped layer file
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'A layer containing the unzip binary for the build function.',
    });

    // Lambda function to handle the build process
    const buildFunction = new lambda.Function(this, `${props.name}BuildLambda`, {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        //const AWS = require('aws-sdk');
        const fs = require('fs');
        const path = require('path');
        const { execSync } = require('child_process');

        //const s3 = new AWS.S3();
        const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
        // Create an instance of the S3 client
        const s3Client = new S3Client();

        // Helper function to convert stream to Buffer
        function streamToBuffer(stream) {
          return new Promise((resolve, reject) => {
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('error', reject);
            stream.on('end', () => resolve(Buffer.concat(chunks)));
          });
        }

        exports.handler = async (event) => {
          console.log('Lambda function triggered by S3 event:', JSON.stringify(event, null, 2));

          // Fetch the site config
          const siteConfig = ${JSON.stringify(siteConfig)};
          const bucketName = event.Records[0].s3.bucket.name;
          const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\\+/g, ' '));
          console.log('Source bucket:', bucketName, ', key:', key);

          // Download the zip file from S3
          const downloadZip = async () => {
            try {
              console.log('Downloading source code from S3...');
              const params = { Bucket: bucketName, Key: key };
              //const data = await s3.getObject(params).promise();
              const data = await s3Client.send(new GetObjectCommand(params));
              const bodyContents = await streamToBuffer(data.Body);
              const zipPath = '/tmp/source.zip';
              fs.writeFileSync(zipPath, bodyContents);
              console.log('Source code downloaded to:', zipPath);

              // Unzip the source code using shell command
              const extractPath = '/tmp/source';
              console.log('Unzipping source code...');
              fs.mkdirSync(extractPath);
              execSync(\`/opt/bin/unzip -o \${zipPath} -d \${extractPath}\`, { stdio: 'inherit' });
              console.log('Source code unpacked to:', extractPath);

              return extractPath;
            } catch (error) {
              console.error('Error downloading or unzipping the source code:', error);
              throw error;
            }
          };

          // Run build process
          try {
            // Download and unzip the source code
            const sourcePath = await downloadZip();

            // Change working directory to the source path
            process.chdir(sourcePath);
            process.env.NPM_CONFIG_CACHE = '/tmp/.npm';

            // Install npm packages
            console.log('Running npm install...');
            execSync('ls && npm install --force', { stdio: 'inherit' });
            console.log('npm install completed.');

            // Write environment configuration
            console.log('Writing environment configuration...');
            const envProdPath = path.join(sourcePath, 'src/environments/environment.prod.ts');
            const envDevPath = path.join(sourcePath, 'src/environments/environment.ts');
            const configContent = 'export const environment = ' + JSON.stringify(siteConfig);

            fs.writeFileSync(envProdPath, configContent);
            fs.writeFileSync(envDevPath, configContent);
            console.log('Environment configuration written to:', envProdPath, 'and', envDevPath);
            console.log(configContent)

            // Run the build command
            console.log('Running npm run build...');
            execSync('npm run build', { stdio: 'inherit' });
            console.log('Build process completed.');

            // Upload built files to S3
            console.log('Uploading built files to S3...');
            const distPath = path.join(sourcePath, 'dist');
            const files = fs.readdirSync(distPath);

            for (const file of files) {
              const filePath = path.join(distPath, file);

              const stats = fs.statSync(filePath);
              if (stats.isDirectory()) continue; 
              const fileContent = fs.readFileSync(filePath);

              var contentType = 'application/octet-stream';
              if (filePath.endsWith('.html')) contentType = 'text/html';
              if (filePath.endsWith('.js')) contentType = 'text/javascript';
              if (filePath.endsWith('.css')) contentType = 'text/css';

              //await s3.putObject({
              //  Bucket: '${props.appBucket.bucketName}',
              //  Key: \`\${file}\`,
              //  Body: fileContent,
              //  CacheControl: 'no-store',
              //}).promise();

              const putObjectParams = {
                Bucket: '${props.appBucket.bucketName}',
                Key: \`\${file}\`,
                Body: fileContent,
                CacheControl: 'no-store',
                ContentType: \`\${contentType}\`,
              }

              const data = await s3Client.send(new PutObjectCommand(putObjectParams));
              console.log('File uploaded successfully:', data);
              console.log(\`Uploaded \${file} to S3\`);
            }

            console.log('All built files uploaded to S3.');
            return {
              statusCode: 200,
              body: JSON.stringify({ message: 'Build and deploy successful' }),
            };
          } catch (error) {
            console.error('Error during build or deploy process:', error);
            throw error;
          }
        };
      `),
      memorySize: 1024,
      timeout: Duration.minutes(5),
      environment: {
        BUCKET_NAME: props.appBucket.bucketName,
      },
      layers: [unzipLayer],  // Add the Lambda Layer here
    });

    // Grant permissions for Lambda to access S3
    props.appBucket.grantReadWrite(buildFunction);
    sourceCodeBucket.grantRead(buildFunction);

    // Trigger Lambda on S3 code upload
    sourceCodeBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      //s3.EventType.OBJECT_CREATED_PUT,
      new s3notifications.LambdaDestination(buildFunction),
      { prefix: props.name }
    );

    // Deploy static assets to the source code bucket; this will trigger the lambda
    const bucketDeployment = new s3deployment.BucketDeployment(this, `${props.name}BucketDeployment`, {
      sources: [s3deployment.Source.asset(props.assetDirectory)],
      destinationBucket: sourceCodeBucket,
      destinationKeyPrefix: props.name,
      extract: false,
      prune: false,
    });
  }
}
