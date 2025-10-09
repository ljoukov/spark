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
import {
  getGoogleServiceAccount,
  type GoogleServiceAccount,
} from "./googleAuth";

export type FirebaseAdminOptions = {
  storageBucket?: string;
};

let cachedApp: App | null = null;
let cachedBucket: string | undefined;

function toServiceAccount(config: GoogleServiceAccount): ServiceAccount {
  return {
    projectId: config.projectId,
    clientEmail: config.clientEmail,
    privateKey: config.privateKey,
  };
}

function resolveServiceAccount(
  config?: GoogleServiceAccount,
): GoogleServiceAccount {
  return config ?? getGoogleServiceAccount();
}

export function getFirebaseAdminApp(
  config?: GoogleServiceAccount,
  options: FirebaseAdminOptions = {},
): App {
  const resolvedConfig = resolveServiceAccount(config);
  const desiredBucket = options.storageBucket;

  if (cachedApp) {
    if (
      desiredBucket !== undefined &&
      cachedBucket !== undefined &&
      desiredBucket !== cachedBucket
    ) {
      throw new Error(
        "Firebase app already initialised with a different storage bucket.",
      );
    }
    return cachedApp;
  }

  const registeredApps = getApps();
  if (registeredApps.length > 0) {
    cachedApp = registeredApps[0]!;
    cachedBucket = desiredBucket ?? cachedBucket;
    return cachedApp;
  }

  const initializeOptions: {
    credential: ReturnType<typeof cert>;
    projectId?: string;
    storageBucket?: string;
  } = {
    credential: cert(toServiceAccount(resolvedConfig)),
    projectId: resolvedConfig.projectId,
  };

  if (desiredBucket) {
    initializeOptions.storageBucket = desiredBucket;
  }

  cachedApp = initializeApp(initializeOptions);
  cachedBucket = desiredBucket ?? cachedBucket;
  return cachedApp;
}

export function getFirebaseAdminAuth(
  config?: GoogleServiceAccount,
  options: FirebaseAdminOptions = {},
): Auth {
  return getAuth(getFirebaseAdminApp(config, options));
}

export function getFirebaseAdminFirestore(
  config?: GoogleServiceAccount,
  options: FirebaseAdminOptions = {},
): Firestore {
  return getFirestore(getFirebaseAdminApp(config, options));
}

export function getFirebaseAdminStorage(
  config?: GoogleServiceAccount,
  options: FirebaseAdminOptions = {},
): Storage {
  return getStorage(getFirebaseAdminApp(config, options));
}
