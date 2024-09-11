import * as cdk from 'aws-cdk-lib';
import { type Construct } from 'constructs';
import { StaticSiteDistro } from './static-site-distro';
import path = require('path');
import { LambdaStaticSite } from './lambda-static-site';
import { LambdaControlPlaneNag } from '../cdknag/lambda-control-plane-nag';
import { addTemplateTag } from '../utilities/helper-functions';
import * as sbt from '@cdklabs/sbt-aws';

interface ControlPlaneStackProps extends cdk.StackProps {
  systemAdminRoleName: string
  systemAdminEmail: string
}

function replaceCognitoUrl(url: string, region: string) {
  // Replace the placeholder with the desired value
  const replacedUrl = url.replace(`https://cognito-idp.${region}.amazonaws.com`, 'http://localhost:4566');

  return replacedUrl;
}

export class LambdaControlPlaneStack extends cdk.Stack {
  public readonly regApiGatewayUrl: string;
  public readonly eventManager: sbt.IEventManager;
  public readonly auth: sbt.CognitoAuth;
  public readonly adminSiteUrl: string;
  public readonly staticSite: LambdaStaticSite;

  constructor (scope: Construct, id: string, props: ControlPlaneStackProps) {
    super(scope, id, props);
    addTemplateTag(this, 'LambdaControlPlaneStack');
    
    const accessLogsBucket = new cdk.aws_s3.Bucket(this, 'AccessLogsBucket', {
      enforceSSL: true,
      autoDeleteObjects: true,
      accessControl: cdk.aws_s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const distro = new StaticSiteDistro(this, 'StaticSiteDistro', {
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      accessLogsBucket
    });

    this.adminSiteUrl = `https://${distro.cloudfrontDistribution.domainName}`;

    const cognitoAuth = new sbt.CognitoAuth(this, 'CognitoAuth', {
      // Avoid checking scopes for API endpoints. Done only for testing purposes.
      // setAPIGWScopes: false,
      controlPlaneCallbackURL: this.adminSiteUrl
    });

    const controlPlane = new sbt.ControlPlane(this, 'controlplane-sbt', {
      systemAdminEmail: props.systemAdminEmail,
      auth: cognitoAuth,
      apiCorsConfig: {
        allowOrigins: ['https://*'],
        allowCredentials: true,
        allowHeaders: ['*'],
        allowMethods: [cdk.aws_apigatewayv2.CorsHttpMethod.ANY],
        maxAge: cdk.Duration.seconds(300),
      },
    });

    this.eventManager = controlPlane.eventManager;
    this.regApiGatewayUrl = controlPlane.controlPlaneAPIGatewayUrl;
    this.auth = cognitoAuth;

    // TODO get region from current stack
    const lstkWellKnownEndpointUrl = replaceCognitoUrl(this.auth.wellKnownEndpointUrl, 'us-east-1')

    const staticSite = new LambdaStaticSite(this, 'AdminWebUi', {
      name: 'AdminSite',
      assetDirectory: path.join(__dirname, '../../../client/AdminWeb'),
      production: true,
      clientId: this.auth.userClientId,  //.clientId,
      issuer: this.auth.tokenEndpoint,
      apiUrl: this.regApiGatewayUrl,
      //wellKnownEndpointUrl: this.auth.wellKnownEndpointUrl,
      wellKnownEndpointUrl: lstkWellKnownEndpointUrl,
      distribution: distro.cloudfrontDistribution,
      appBucket: distro.siteBucket,
      accessLogsBucket
    });
    
    new cdk.CfnOutput(this, 'adminSiteUrl', {
      value: this.adminSiteUrl
    });

    new LambdaControlPlaneNag(this, 'controlplane-nag');
  }
}
