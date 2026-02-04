import type { Firestore } from "firebase-admin/firestore";

import { assertNodeRuntime } from "./runtime";

export type FirestoreListenUnsubscribe = () => void;

export function listenFirestoreDoc<TDoc>(options: {
  firestore: Firestore;
  docPath: string;
  onNext: (doc: TDoc | null) => void;
  onError?: (error: unknown) => void;
}): FirestoreListenUnsubscribe {
  assertNodeRuntime("Firestore listeners");

  const unsubscribe = options.firestore.doc(options.docPath).onSnapshot(
    (snapshot) => {
      if (!snapshot.exists) {
        options.onNext(null);
        return;
      }
      options.onNext(snapshot.data() as TDoc);
    },
    (error) => {
      options.onError?.(error);
    },
  );

  return unsubscribe;
}
