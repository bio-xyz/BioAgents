import express from 'express';

type Environment = 'development' | 'staging' | 'production';

interface AuthConfig {
  privyAppId: string;
  privyAppSecret: string;
  serverAuthToken?: string;
  nodeEnv: Environment;
}

const ORIGINS_CONFIG = {
  development: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:4000',
    'https://your-dev-domain.com',
  ],
  staging: ['http://your-staging-ip', 'https://staging.yourdomain.com', 'https://dev.yourdomain.com'],
  production: ['https://yourdomain.com', 'https://your-production-domain.com'],
} as const;

const STAGING_BYPASS_ORIGIN = 'https://your-staging-bypass-domain.com';

function getEnvironment(): Environment {
  const env = process.env.NODE_ENV;
  if (env === 'production' || env === 'staging') {
    return env;
  }
  return 'development';
}

function getAllowedOrigins(environment: Environment): string[] {
  return [...(ORIGINS_CONFIG[environment] || ORIGINS_CONFIG.development)];
}

export const corsOptions = {
  origin: function (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void
  ) {
    const environment = getEnvironment();
    const allowedOrigins = getAllowedOrigins(environment);

    // Allow requests with no origin (server-to-server calls)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.warn(`[CORS] Origin not allowed: ${origin}. Environment: ${environment}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-KEY'],
};

function validateAuthConfig(): AuthConfig {
  const privyAppId = process.env.PRIVY_APP_ID;
  const privyAppSecret = process.env.PRIVY_APP_SECRET;
  const nodeEnv = getEnvironment();

  if (!privyAppId || !privyAppSecret) {
    const missing: string[] = [];
    if (!privyAppId) missing.push('PRIVY_APP_ID');
    if (!privyAppSecret) missing.push('PRIVY_APP_SECRET');
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    privyAppId,
    privyAppSecret,
    serverAuthToken: process.env.ELIZA_SERVER_AUTH_TOKEN,
    nodeEnv,
  };
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;

  const bearerPrefix = 'Bearer ';
  if (authHeader.startsWith(bearerPrefix)) {
    return authHeader.slice(bearerPrefix.length);
  }

  return null;
}

function shouldBypassAuth(config: AuthConfig, req: express.Request): boolean {
  // Always bypass in development
  if (config.nodeEnv === 'development') {
    console.log(`[AUTH] Bypassing authentication in development mode for ${req.originalUrl}`);
    return true;
  }

  // Check for valid X-API-KEY for server-to-server requests
  const apiKey = req.headers['x-api-key'] as string;
  if (config.serverAuthToken && apiKey === config.serverAuthToken) {
    console.log(`[AUTH] Valid X-API-KEY provided, bypassing JWT auth for ${req.originalUrl}`);
    return true;
  }

  // For staging, bypass JWT for requests from staging Eliza server
  if (config.nodeEnv === 'staging') {
    const origin = req.headers.origin;
    if (origin === STAGING_BYPASS_ORIGIN) {
      console.log(`[AUTH] Bypassing authentication for staging Eliza server: ${origin}`);
      return true;
    }
  }

  return false;
}

export async function jwtAuth(
  req: express.Request & { user?: any },
  res: express.Response,
  next: express.NextFunction
): Promise<void> {
  try {
    const config = validateAuthConfig();

    if (shouldBypassAuth(config, req)) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    const token = extractBearerToken(authHeader);

    if (!token) {
      console.warn(`[AUTH] No valid bearer token found for ${req.originalUrl}`);
      res.status(401).json({
        error: 'Authentication token required',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    const { PrivyClient } = await import('@privy-io/server-auth');
    const privy = new PrivyClient(config.privyAppId, config.privyAppSecret);

    const payload = await privy.verifyAuthToken(token);
    req.user = payload;

    console.log(
      `[AUTH] Token verified successfully for user ${(payload as any).sub || 'unknown'} on ${req.originalUrl}`
    );
    next();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (
      error instanceof Error &&
      error.message.includes('Missing required environment variables')
    ) {
      console.error(`[AUTH] Configuration error: ${errorMessage}`);
      res.status(500).json({
        error: 'Authentication service configuration error',
        code: 'CONFIG_ERROR',
      });
      return;
    }

    console.warn(`[AUTH] Token verification failed for ${req.originalUrl}: ${errorMessage}`);
    res.status(401).json({
      error: 'Invalid authentication token',
      code: 'INVALID_TOKEN',
    });
  }
}
