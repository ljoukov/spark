import SwiftUI

extension View {
    @ViewBuilder
    func glassSurface<S: Shape>(
        _ shape: S,
        fallbackMaterial: Material = .ultraThinMaterial,
        strokeOpacity: Double = 0.14
    ) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular, in: shape)
        } else {
            self
                .background(fallbackMaterial, in: shape)
                .overlay(
                    shape.stroke(Color.primary.opacity(strokeOpacity), lineWidth: 1)
                )
        }
    }
}

struct CheckMateBackground: View {
    var body: some View {
        LinearGradient(
            colors: [
                Color(.systemBackground),
                Color(.secondarySystemBackground)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }
}
