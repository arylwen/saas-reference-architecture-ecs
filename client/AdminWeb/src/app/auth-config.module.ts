import { NgModule } from '@angular/core';
import { AuthModule, LogLevel, OidcSecurityService } from 'angular-auth-oidc-client';
import { environment } from 'src/environments/environment';
import { LstkOidcSecurityService } from './lstk-oidc-security-service';

@NgModule({
  imports: [
    AuthModule.forRoot({
      config: {
        authority: environment.issuer,
        authWellknownEndpointUrl: environment.wellKnownEndpointUrl,
        clientId: environment.clientId,
        logLevel: LogLevel.Debug,
        postLogoutRedirectUri: window.location.origin,
        redirectUrl: window.location.origin,
        responseType: 'code',
        scope: 'openid profile email tenant/tenant_read tenant/tenant_write user/user_read user/user_write',
        ignoreNonceAfterRefresh: true, 
        disableIdTokenValidation: true,
      },
    }),
  ],  
  //lstck bug https://github.com/localstack/localstack/issues/11501, remove when fixed
  providers: [
    { provide: OidcSecurityService, useClass: LstkOidcSecurityService },
  ],  
  exports: [AuthModule],
})
export class AuthConfigModule {}
