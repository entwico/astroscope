export type CapIntegrationOptions = {
  /** prefix the challenge and redeem proxy is served under; defaults to `/_cap/` */
  path?: string | undefined;
};

export type CapConfig = {
  /** base url of the cap standalone service, e.g. `https://cap.cap:3000` */
  baseUrl: string;
  siteKey: string;
  secretKey: string;
};
