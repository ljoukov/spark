import FirebaseAuth
import FirebaseFirestore
import Combine

@MainActor
final class FirebaseClients: ObservableObject {
    lazy var auth: Auth = Auth.auth()
    lazy var firestore: Firestore = Firestore.firestore()
}
