import { ConnectorError, ConnectorErrorCodes } from '@logto/connector-kit';
import { generateStandardId } from '@logto/shared/universal';
import { assert, conditional } from '@silverhand/essentials';
import snakecaseKeys from 'snakecase-keys';

import { type BaseOidcConfig, type BasicOidcConnectorConfig } from '../types/oidc.js';
import { type ExtendedSocialUserInfo } from '../types/saml.js';
import {
  type SingleSignOnConnectorSession,
  type CreateSingleSignOnSession,
} from '../types/session.js';

import { fetchOidcConfig, fetchToken, getIdTokenClaims } from './utils.js';

/**
 * OIDC connector
 *
 * @remark General connector for OIDC provider.
 * This class provides the basic functionality to connect with a OIDC provider.
 * All the OIDC single sign-on connector should extend this class.
 *  @see @logto/connector-kit.
 *
 * @property config The OIDC connector config
 * @method getOidcConfig Fetch the full-list of OIDC config from the issuer. Throws error if config is invalid
 * @method getAuthorizationUrl Generate the authorization URL for the OIDC provider
 * @method getUserInfo Handle the sign-in callback from the OIDC provider and return the user info
 */
class OidcConnector {
  constructor(private readonly config: BasicOidcConnectorConfig) {}

  /* Fetch the full-list of OIDC config from the issuer. Throws error if config is invalid */
  async getOidcConfig(): Promise<BaseOidcConfig> {
    const { issuer } = this.config;

    const oidcConfig = await fetchOidcConfig(issuer);

    return {
      ...this.config,
      ...oidcConfig,
    };
  }

  /**
   * Generate the authorization URL for the OIDC provider
   *
   * @param oidcQueryParams The query params for the OIDC provider
   * @param oidcQueryParams.state The state generated by Logto experience client
   * @param oidcQueryParams.redirectUri The redirect uri for the OIDC provider
   * @param setSession Set the connector session data to the oidc provider session storage.
   */
  async getAuthorizationUrl(
    {
      state,
      redirectUri,
      connectorId,
    }: { state: string; redirectUri: string; connectorId: string },
    setSession: CreateSingleSignOnSession
  ) {
    assert(
      setSession,
      new ConnectorError(ConnectorErrorCodes.NotImplemented, {
        message: 'Connector session storage is not implemented.',
      })
    );

    const oidcConfig = await this.getOidcConfig();
    const nonce = generateStandardId();

    await setSession({ nonce, redirectUri, connectorId, state });

    const queryParameters = new URLSearchParams({
      state,
      nonce,
      ...snakecaseKeys({
        clientId: oidcConfig.clientId,
        responseType: 'code',
        redirectUri,
      }),
      scope: oidcConfig.scope,
    });

    return `${oidcConfig.authorizationEndpoint}?${queryParameters.toString()}`;
  }

  get issuer() {
    return this.config.issuer;
  }

  /**
   * Handle the sign-in callback from the OIDC provider and return the user info
   *
   * @param data unknown oidc authorization response
   * @param connectorSession The connector session data from the oidc provider session storage
   * @returns The user info from the OIDC provider
   * @remark Forked from @logto/oidc-connector
   *
   */
  async getUserInfo(
    connectorSession: SingleSignOnConnectorSession,
    data: unknown
  ): Promise<ExtendedSocialUserInfo> {
    const oidcConfig = await this.getOidcConfig();
    const { nonce, redirectUri } = connectorSession;

    // Fetch token from the OIDC provider using authorization code
    const { idToken } = await fetchToken(oidcConfig, data, redirectUri);

    // Decode and verify the id token
    const { sub, name, picture, email, email_verified, phone, phone_verified } =
      await getIdTokenClaims(idToken, oidcConfig, nonce);

    return {
      id: sub,
      ...conditional(name && { name }),
      ...conditional(picture && { avatar: picture }),
      ...conditional(email && email_verified && { email }),
      ...conditional(phone && phone_verified && { phone }),
    };
  }
}

export default OidcConnector;
