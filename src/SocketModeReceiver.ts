/* eslint-disable @typescript-eslint/explicit-member-accessibility, @typescript-eslint/strict-boolean-expressions */
import { SocketModeClient } from '@slack/socket-mode';
import { createServer } from 'http';
import { Logger, ConsoleLogger, LogLevel } from '@slack/logger';
import { InstallProvider, CallbackOptions, InstallProviderOptions, InstallURLOptions } from '@slack/oauth';
import App from './App';
import { Receiver, ReceiverEvent } from './types';

// TODO: we throw away the key names for endpoints, so maybe we should use this interface. is it better for migrations?
// if that's the reason, let's document that with a comment.
export interface SocketModeReceiverOptions {
  logger?: Logger;
  logLevel?: LogLevel;
  clientId?: string;
  clientSecret?: string;
  stateSecret?: InstallProviderOptions['stateSecret']; // required when using default stateStore
  installationStore?: InstallProviderOptions['installationStore']; // default MemoryInstallationStore
  scopes?: InstallURLOptions['scopes'];
  installerOptions?: InstallerOptions;
  token?: string; // App Level Token
}

// Additional Installer Options
interface InstallerOptions {
  stateStore?: InstallProviderOptions['stateStore']; // default ClearStateStore
  authVersion?: InstallProviderOptions['authVersion']; // default 'v2'
  metadata?: InstallURLOptions['metadata'];
  installPath?: string;
  redirectUriPath?: string;
  callbackOptions?: CallbackOptions;
  userScopes?: InstallURLOptions['userScopes'];
  clientOptions?: InstallProviderOptions['clientOptions'];
  authorizationUrl?: InstallProviderOptions['authorizationUrl'];
  port?: number;
}

/**
 * Receives HTTP requests with Events, Slash Commands, and Actions
 */
export default class SocketModeReceiver implements Receiver {
  /* Express app */
  public client: SocketModeClient;

  private bolt: App | undefined;

  private logger: Logger;

  public installer: InstallProvider | undefined = undefined;

  constructor({
    token = undefined,
    logger = undefined,
    logLevel = LogLevel.INFO,
    clientId = undefined,
    clientSecret = undefined,
    stateSecret = undefined,
    installationStore = undefined,
    scopes = undefined,
    installerOptions = {},
  }: SocketModeReceiverOptions) {
    this.client = new SocketModeClient({
      token,
      logLevel,
      clientOptions: installerOptions.clientOptions,
    });

    // const expressMiddleware: RequestHandler[] = [
    // TODO: Should we still be verifying Signature?
    //   verifySignatureAndParseRawBody(logger, signingSecret),
    //   respondToSslCheck,
    //   respondToUrlVerification,
    //   this.requestHandler.bind(this),
    // ];

    if (typeof logger !== 'undefined') {
      this.logger = logger;
    } else {
      this.logger = new ConsoleLogger();
      this.logger.setLevel(logLevel);
    }

    if (
      clientId !== undefined &&
      clientSecret !== undefined &&
      (stateSecret !== undefined || installerOptions.stateStore !== undefined)
    ) {
      this.installer = new InstallProvider({
        clientId,
        clientSecret,
        stateSecret,
        installationStore,
        logLevel,
        logger, // pass logger that was passed in constructor, not one created locally
        stateStore: installerOptions.stateStore,
        authVersion: installerOptions.authVersion!,
        clientOptions: installerOptions.clientOptions,
        authorizationUrl: installerOptions.authorizationUrl,
      });
    }

    // Add OAuth routes to receiver
    if (this.installer !== undefined) {
      // use default or passed in redirect path
      const redirectUriPath =
        installerOptions.redirectUriPath === undefined ? '/slack/oauth_redirect' : installerOptions.redirectUriPath;

      // use default or passed in installPath
      const installPath = installerOptions.installPath === undefined ? '/slack/install' : installerOptions.installPath;

      const server = createServer(async (req, res) => {
        if (req.url === redirectUriPath) {
          // call installer.handleCallback to wrap up the install flow
          await this.installer!.handleCallback(req, res);
        }

        if (req.url === installPath) {
          try {
            const url = await this.installer!.generateInstallUrl({
              metadata: installerOptions.metadata,
              scopes: scopes!,
              userScopes: installerOptions.userScopes,
            });
            res.writeHead(200, {});
            res.end(`<html><body><a href=${url}><img alt=""Add to Slack"" height="40" width="139"
                src="https://platform.slack-edge.com/img/add_to_slack.png"
                srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x,
                https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a></body></html>`);
          } catch (err) {
            throw new Error(err);
          }
        }
      });

      const port = installerOptions.port === undefined ? 3000 : installerOptions.port;
      this.logger.info(`listening on port ${port} for OAuth`);
      this.logger.info(`Go to http://localhost:${port}/slack/install to initiate OAuth flow`);
      // use port 3000 by default
      server.listen(port);
    }

    this.client.on('slack_event', async ({ ack, body }) => {
      this.logger.info('catch all events');
      // await ack();
      const event: ReceiverEvent = {
        body,
        ack,
      };
      await this.bolt?.processEvent(event);
    });
  }

  public init(bolt: App): void {
    this.bolt = bolt;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // start socket mode client
        this.client.start();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.client.disconnect();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }
}
