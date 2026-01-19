import type { App, ServiceAccount } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import {
  getGoogleServiceAccount,
  type GoogleServiceAccount,
} from "./googleAuth";

type FirebaseAdminAppModule = typeof import("firebase-admin/app");
type FirebaseAdminAuthModule = typeof import("firebase-admin/auth");
type FirebaseAdminFirestoreModule = typeof import("firebase-admin/firestore");
type FirebaseAdminStorageModule = typeof import("firebase-admin/storage");

// Load firebase-admin lazily for Node while keeping bundlers aware of these CJS modules.
const firebaseAdminAppModule: FirebaseAdminAppModule =
  await import("firebase-admin/app");
const firebaseAdminAuthModule: FirebaseAdminAuthModule =
  await import("firebase-admin/auth");
const firebaseAdminFirestoreModule: FirebaseAdminFirestoreModule =
  await import("firebase-admin/firestore");
const firebaseAdminStorageModule: FirebaseAdminStorageModule =
  await import("firebase-admin/storage");

let cachedApp: App | null = null;
let cachedBucket: string | null = null;

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

function resolveStorageBucketName(config: GoogleServiceAccount): string {
  return `${config.projectId}.firebasestorage.app`;
}

function ensureStorageBucket(config: GoogleServiceAccount): string {
  if (cachedBucket) {
    return cachedBucket;
  }
  const bucket = resolveStorageBucketName(config);
  cachedBucket = bucket;
  return bucket;
}

export function getFirebaseAdminApp(config?: GoogleServiceAccount): App {
  const { cert, getApps, initializeApp } = firebaseAdminAppModule;
  const resolvedConfig = resolveServiceAccount(config);
  const resolvedBucket = ensureStorageBucket(resolvedConfig);

  if (cachedApp) {
    return cachedApp;
  }

  const registeredApps = getApps();
  if (registeredApps.length > 0) {
    cachedApp = registeredApps[0]!;
    const existingBucket = cachedApp.options?.storageBucket;
    if (existingBucket && existingBucket !== resolvedBucket) {
      throw new Error(
        `Firebase app already initialised with unexpected storage bucket '${existingBucket}'.`,
      );
    }
    cachedBucket = existingBucket ?? resolvedBucket;
    return cachedApp;
  }

  const initializeOptions: {
    credential: ReturnType<typeof cert>;
    projectId?: string;
    storageBucket?: string;
  } = {
    credential: cert(toServiceAccount(resolvedConfig)),
    projectId: resolvedConfig.projectId,
    storageBucket: resolvedBucket,
  };

  cachedApp = initializeApp(initializeOptions);
  cachedBucket = resolvedBucket;
  return cachedApp;
}

export function getFirebaseAdminAuth(config?: GoogleServiceAccount): Auth {
  const { getAuth } = firebaseAdminAuthModule;
  return getAuth(getFirebaseAdminApp(config));
}

export function getFirebaseAdminFirestore(
  config?: GoogleServiceAccount,
): Firestore {
  const { getFirestore } = firebaseAdminFirestoreModule;
  return getFirestore(getFirebaseAdminApp(config));
}

export function getFirebaseAdminStorage(
  config?: GoogleServiceAccount,
): Storage {
  const { getStorage } = firebaseAdminStorageModule;
  return getStorage(getFirebaseAdminApp(config));
}

export function getFirebaseAdminFirestoreModule(): FirebaseAdminFirestoreModule {
  return firebaseAdminFirestoreModule;
}

export function getFirebaseStorageBucketName(
  config?: GoogleServiceAccount,
): string {
  const resolvedConfig = resolveServiceAccount(config);
  return ensureStorageBucket(resolvedConfig);
}
