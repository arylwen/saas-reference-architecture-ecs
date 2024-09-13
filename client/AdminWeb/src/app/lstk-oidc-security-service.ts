import { Injectable } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class LstkOidcSecurityService extends OidcSecurityService {
  // If you need to customize, override the method here
  protected validateNonce(): Observable<boolean> {
    // Bypass nonce validation logic here
    return of(true); // Always return true to bypass nonce checks
  }
}
