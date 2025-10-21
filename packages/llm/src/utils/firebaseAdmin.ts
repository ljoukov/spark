import { createRequire } from "node:module";
import type { App, ServiceAccount } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import {
  getGoogleServiceAccount,
  type GoogleServiceAccount,
} from "./googleAuth";

const requireFirebase = createRequire(import.meta.url);

type FirebaseAdminAppModule = typeof import("firebase-admin/app");
type FirebaseAdminAuthModule = typeof import("firebase-admin/auth");
type FirebaseAdminFirestoreModule = typeof import("firebase-admin/firestore");
type FirebaseAdminStorageModule = typeof import("firebase-admin/storage");

let firebaseAdminAppModule: FirebaseAdminAppModule | null = null;
let firebaseAdminAuthModule: FirebaseAdminAuthModule | null = null;
let firebaseAdminFirestoreModule: FirebaseAdminFirestoreModule | null = null;
let firebaseAdminStorageModule: FirebaseAdminStorageModule | null = null;

function loadFirebaseAdminAppModule(): FirebaseAdminAppModule {
  if (firebaseAdminAppModule === null) {
    firebaseAdminAppModule = requireFirebase(
      "firebase-admin/app",
    ) as FirebaseAdminAppModule;
  }
  return firebaseAdminAppModule;
}

function loadFirebaseAdminAuthModule(): FirebaseAdminAuthModule {
  if (firebaseAdminAuthModule === null) {
    firebaseAdminAuthModule = requireFirebase(
      "firebase-admin/auth",
    ) as FirebaseAdminAuthModule;
  }
  return firebaseAdminAuthModule;
}

function loadFirebaseAdminFirestoreModule(): FirebaseAdminFirestoreModule {
  if (firebaseAdminFirestoreModule === null) {
    firebaseAdminFirestoreModule = requireFirebase(
      "firebase-admin/firestore",
    ) as FirebaseAdminFirestoreModule;
  }
  return firebaseAdminFirestoreModule;
}

function loadFirebaseAdminStorageModule(): FirebaseAdminStorageModule {
  if (firebaseAdminStorageModule === null) {
    firebaseAdminStorageModule = requireFirebase(
      "firebase-admin/storage",
    ) as FirebaseAdminStorageModule;
  }
  return firebaseAdminStorageModule;
}

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
  const { cert, getApps, initializeApp } = loadFirebaseAdminAppModule();
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
  const { getAuth } = loadFirebaseAdminAuthModule();
  return getAuth(getFirebaseAdminApp(config, options));
}

export function getFirebaseAdminFirestore(
  config?: GoogleServiceAccount,
  options: FirebaseAdminOptions = {},
): Firestore {
  const { getFirestore } = loadFirebaseAdminFirestoreModule();
  return getFirestore(getFirebaseAdminApp(config, options));
}

export function getFirebaseAdminStorage(
  config?: GoogleServiceAccount,
  options: FirebaseAdminOptions = {},
): Storage {
  const { getStorage } = loadFirebaseAdminStorageModule();
  return getStorage(getFirebaseAdminApp(config, options));
}

export function getFirebaseAdminFirestoreModule(): FirebaseAdminFirestoreModule {
  return loadFirebaseAdminFirestoreModule();
}
