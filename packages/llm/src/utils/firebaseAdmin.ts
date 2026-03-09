import type { App, ServiceAccount } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";

import { parseGoogleServiceAccountJson } from "./gcp/googleAccessToken";
import { assertNodeRuntime } from "./runtime";

type FirebaseAdminAppModule = typeof import("firebase-admin/app");
type FirebaseAdminFirestoreModule = typeof import("firebase-admin/firestore");

let cachedAppPromise: Promise<App> | null = null;
let cachedAppKey: string | null = null;
let cachedFirestorePromise: Promise<Firestore> | null = null;

let cachedAppModulePromise: Promise<FirebaseAdminAppModule> | null = null;
let cachedFirestoreModulePromise: Promise<FirebaseAdminFirestoreModule> | null =
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
        },
        appName,
      );
    }

    return app;
  })();

  cachedAppPromise = promise;
  cachedAppKey = appKey;
  cachedFirestorePromise = null;
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

export async function getFirebaseAdminFirestoreModule(): Promise<FirebaseAdminFirestoreModule> {
  return loadFirebaseAdminFirestoreModule();
}
