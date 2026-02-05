import type { App, ServiceAccount } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";

import { parseGoogleServiceAccountJson } from "./gcp/googleAccessToken";
import { assertNodeRuntime } from "./runtime";

type FirebaseAdminAppModule = typeof import("firebase-admin/app");
type FirebaseAdminFirestoreModule = typeof import("firebase-admin/firestore");
type FirebaseAdminStorageModule = typeof import("firebase-admin/storage");

let cachedAppPromise: Promise<App> | null = null;
let cachedAppKey: string | null = null;
let cachedFirestorePromise: Promise<Firestore> | null = null;
let cachedStoragePromise: Promise<Storage> | null = null;

let cachedAppModulePromise: Promise<FirebaseAdminAppModule> | null = null;
let cachedFirestoreModulePromise: Promise<FirebaseAdminFirestoreModule> | null =
  null;
let cachedStorageModulePromise: Promise<FirebaseAdminStorageModule> | null =
  null;

function parseServiceAccount(
  serviceAccountJson: string,
): ReturnType<typeof parseGoogleServiceAccountJson> {
  return parseGoogleServiceAccountJson(serviceAccountJson);
}

function serviceAccountToAppKey(serviceAccountJson: string): string {
  const sa = parseServiceAccount(serviceAccountJson);
  return `${sa.projectId}:${sa.clientEmail}`;
}

function toFirebaseServiceAccount(serviceAccountJson: string): ServiceAccount {
  const sa = parseServiceAccount(serviceAccountJson);
  return {
    projectId: sa.projectId,
    clientEmail: sa.clientEmail,
    privateKey: sa.privateKey,
  };
}

export function resolveFirebaseStorageBucketName(
  serviceAccountJson: string,
): string {
  const sa = parseServiceAccount(serviceAccountJson);
  return `${sa.projectId}.firebasestorage.app`;
}

function sanitizeAppNameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_");
}

async function loadFirebaseAdminAppModule(): Promise<FirebaseAdminAppModule> {
  assertNodeRuntime("Firebase Admin SDK");

  if (!cachedAppModulePromise) {
    cachedAppModulePromise = import(
      /* @vite-ignore */ "firebase-admin/app"
    ) as Promise<FirebaseAdminAppModule>;
  }
  return cachedAppModulePromise;
}

async function loadFirebaseAdminFirestoreModule(): Promise<FirebaseAdminFirestoreModule> {
  assertNodeRuntime("Firebase Admin SDK");

  if (!cachedFirestoreModulePromise) {
    cachedFirestoreModulePromise = import(
      /* @vite-ignore */ "firebase-admin/firestore"
    ) as Promise<FirebaseAdminFirestoreModule>;
  }
  return cachedFirestoreModulePromise;
}

async function loadFirebaseAdminStorageModule(): Promise<FirebaseAdminStorageModule> {
  assertNodeRuntime("Firebase Admin SDK");

  if (!cachedStorageModulePromise) {
    cachedStorageModulePromise = import(
      /* @vite-ignore */ "firebase-admin/storage"
    ) as Promise<FirebaseAdminStorageModule>;
  }
  return cachedStorageModulePromise;
}

export async function getFirebaseAdminApp(options: {
  serviceAccountJson: string;
}): Promise<App> {
  assertNodeRuntime("Firebase Admin SDK");

  const appKey = serviceAccountToAppKey(options.serviceAccountJson);
  if (cachedAppPromise && cachedAppKey === appKey) {
    return cachedAppPromise;
  }

  const promise = (async (): Promise<App> => {
    const { cert, getApp, initializeApp } = await loadFirebaseAdminAppModule();

    const bucketName = resolveFirebaseStorageBucketName(
      options.serviceAccountJson,
    );
    const appName = `spark-${sanitizeAppNameSegment(appKey)}`;

    let app: App | null = null;
    try {
      app = getApp(appName);
    } catch {
      app = null;
    }

    if (!app) {
      // Prefer a named app to avoid collisions across different credentials.
      const sa = parseServiceAccount(options.serviceAccountJson);

      app = initializeApp(
        {
          credential: cert(
            toFirebaseServiceAccount(options.serviceAccountJson),
          ),
          projectId: sa.projectId,
          storageBucket: bucketName,
        },
        appName,
      );
    }

    return app;
  })();

  cachedAppPromise = promise;
  cachedAppKey = appKey;
  cachedFirestorePromise = null;
  cachedStoragePromise = null;
  return promise;
}

export async function getFirebaseAdminFirestore(options: {
  serviceAccountJson: string;
}): Promise<Firestore> {
  assertNodeRuntime("Firestore Admin SDK");

  const appKey = serviceAccountToAppKey(options.serviceAccountJson);
  if (cachedFirestorePromise && cachedAppKey === appKey) {
    return cachedFirestorePromise;
  }

  const appPromise = getFirebaseAdminApp(options);
  const promise = (async (): Promise<Firestore> => {
    const app = await appPromise;
    const { getFirestore } = await loadFirebaseAdminFirestoreModule();
    const firestore = getFirestore(app);

    // Match our REST helpers: omit undefined fields in writes.
    firestore.settings({ ignoreUndefinedProperties: true });

    return firestore;
  })();

  cachedFirestorePromise = promise;
  return promise;
}

export async function getFirebaseAdminStorage(options: {
  serviceAccountJson: string;
}): Promise<Storage> {
  assertNodeRuntime("Storage Admin SDK");

  const appKey = serviceAccountToAppKey(options.serviceAccountJson);
  if (cachedStoragePromise && cachedAppKey === appKey) {
    return cachedStoragePromise;
  }

  const appPromise = getFirebaseAdminApp(options);
  const promise = (async (): Promise<Storage> => {
    const app = await appPromise;
    const { getStorage } = await loadFirebaseAdminStorageModule();
    return getStorage(app);
  })();

  cachedStoragePromise = promise;
  return promise;
}

export async function getFirebaseAdminFirestoreModule(): Promise<FirebaseAdminFirestoreModule> {
  return loadFirebaseAdminFirestoreModule();
}
