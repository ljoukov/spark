import { assertNodeRuntime } from "./runtime";

export type FirestoreListenUnsubscribe = () => void;

export type FirestoreListenDocSnapshot = {
  exists: boolean;
  data: () => unknown;
};

export type FirestoreListenFirestore = {
  doc: (
    docPath: string,
  ) => {
    onSnapshot: (
      onNext: (snapshot: FirestoreListenDocSnapshot) => void,
      onError?: (error: unknown) => void,
    ) => FirestoreListenUnsubscribe;
  };
};

export function listenFirestoreDoc<TDoc>(options: {
  firestore: FirestoreListenFirestore;
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
