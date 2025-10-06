import {
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import { z } from "zod";
import { loadLocalEnv } from "./env";

export type FirebaseAdminOptions = {
  storageBucket?: string;
};

export type FirebaseServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

const serviceAccountJsonSchema = z
  .object({
    project_id: z.string().min(1),
    client_email: z.string().email(),
    private_key: z.string().min(1),
  })
  .transform(({ project_id, client_email, private_key }) => ({
    projectId: project_id,
    clientEmail: client_email,
    privateKey: private_key.replace(/\\n/g, "\n"),
  }));

export function parseFirebaseServiceAccount(
  input: string,
): FirebaseServiceAccount {
  try {
    const parsed = JSON.parse(input);
    return serviceAccountJsonSchema.parse(parsed);
  } catch (error) {
    console.error("Failed to parse Firebase service account JSON", error);
    throw new Error("Invalid Firebase service account JSON");
  }
}

const appCache = new Map<string, App>();

function cacheKey(
  config: FirebaseServiceAccount,
  options?: FirebaseAdminOptions,
): string {
  const bucket = options?.storageBucket ?? "";
  return `${config.projectId}|${bucket}`;
}

function toServiceAccount(config: FirebaseServiceAccount): ServiceAccount {
  return {
    projectId: config.projectId,
    clientEmail: config.clientEmail,
    privateKey: config.privateKey,
  };
}

function resolveServiceAccount(
  config?: FirebaseServiceAccount,
): FirebaseServiceAccount {
  if (config) {
    return config;
  }
  loadLocalEnv();
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json || json.trim().length === 0) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must be provided");
  }
  return parseFirebaseServiceAccount(json);
}

export function getFirebaseAdminApp(
  config?: FirebaseServiceAccount,
  options: FirebaseAdminOptions = {},
): App {
  const resolvedConfig = resolveServiceAccount(config);
  const key = cacheKey(resolvedConfig, options);
  const cached = appCache.get(key);
  if (cached) {
    return cached;
  }

  const registeredApps = getApps();
  if (registeredApps.length > 0) {
    const existing = registeredApps[0]!;
    appCache.set(key, existing);
    return existing;
  }

  const initializeOptions: {
    credential: ReturnType<typeof cert>;
    projectId?: string;
    storageBucket?: string;
  } = {
    credential: cert(toServiceAccount(resolvedConfig)),
    projectId: resolvedConfig.projectId,
  };

  if (options.storageBucket) {
    initializeOptions.storageBucket = options.storageBucket;
  }

  const app = initializeApp(initializeOptions);
  appCache.set(key, app);
  return app;
}

export function getFirebaseAdminAuth(
  config?: FirebaseServiceAccount,
  options: FirebaseAdminOptions = {},
): Auth {
  return getAuth(getFirebaseAdminApp(config, options));
}

export function getFirebaseAdminFirestore(
  config?: FirebaseServiceAccount,
  options: FirebaseAdminOptions = {},
): Firestore {
  return getFirestore(getFirebaseAdminApp(config, options));
}

export function getFirebaseAdminStorage(
  config?: FirebaseServiceAccount,
  options: FirebaseAdminOptions = {},
): Storage {
  return getStorage(getFirebaseAdminApp(config, options));
}
