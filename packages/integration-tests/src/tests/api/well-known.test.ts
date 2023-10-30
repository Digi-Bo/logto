import { type SignInExperience, type Translation, type SsoConnectorMetadata } from '@logto/schemas';
import { HTTPError } from 'got';

import api, { adminTenantApi, authedAdminApi } from '#src/api/api.js';
import { createSsoConnector, deleteSsoConnectorById } from '#src/api/sso-connector.js';
import { logtoUrl } from '#src/constants.js';

describe('.well-known api', () => {
  it('should return tenant endpoint URL for any given tenant id', async () => {
    const { user } = await adminTenantApi.get(`.well-known/endpoints/123`).json<{ user: string }>();
    expect(user).not.toBeNull();
  });

  it('should not found API route in non-admin tenant', async () => {
    const response = await api.get('.well-known/endpoints/123').catch((error: unknown) => error);
    expect(response instanceof HTTPError && response.response.statusCode === 404).toBe(true);
  });

  it('get /.well-known/sign-in-exp for console', async () => {
    const response = await adminTenantApi.get('.well-known/sign-in-exp').json<SignInExperience>();

    expect(response).toMatchObject({
      signUp: {
        identifiers: ['username'],
        password: true,
        verify: false,
      },
      signIn: {
        methods: [
          {
            identifier: 'username',
            password: true,
            verificationCode: false,
            isPasswordPrimary: true,
          },
        ],
      },
      signInMode: 'SignInAndRegister',
    });
  });

  // Also test for Redis cache invalidation
  it('should be able to return updated phrases', async () => {
    const notification = 'Big brother is watching you.';
    const original = await api
      .get('.well-known/phrases?lng=en')
      .json<{ translation: Translation }>();

    expect(original.translation.demo_app).not.toHaveProperty('notification', notification);

    await authedAdminApi.put('custom-phrases/en', { json: { demo_app: { notification } } });
    const updated = await api
      .get('.well-known/phrases?lng=en')
      .json<{ translation: Translation }>();
    expect(updated.translation.demo_app).toHaveProperty('notification', notification);
  });

  describe('sso connectors in sign-in experience', () => {
    const logtoIssuer = `${logtoUrl}/oidc`;

    const newOIDCSsoConnector = {
      providerName: 'OIDC',
      connectorName: 'OIDC sso connector',
      branding: {
        logo: 'https://logto.io/oidc-logo.png',
        darkLogo: 'https://logto.io/oidc-dark-logo.png',
      },
      config: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        issuer: logtoIssuer,
      },
    };

    it('should get the sso connectors in sign-in experience', async () => {
      const { id, connectorName, domains } = await createSsoConnector(newOIDCSsoConnector);

      const signInExperience = await api
        .get('.well-known/sign-in-exp')
        .json<SignInExperience & { ssoConnectors: SsoConnectorMetadata[] }>();

      expect(signInExperience.ssoConnectors.length).toBeGreaterThan(0);

      const newCreatedConnector = signInExperience.ssoConnectors.find(
        (connector) => connector.id === id
      );

      expect(newCreatedConnector).toMatchObject({
        id,
        connectorName,
        domains,
        logo: newOIDCSsoConnector.branding.logo,
        darkLogo: newOIDCSsoConnector.branding.darkLogo,
      });

      await deleteSsoConnectorById(id);
    });
  });
});
