import SwiftUI

extension View {
    @ViewBuilder
    func glassSurface<S: Shape>(
        _ shape: S,
        fallbackMaterial: Material = .ultraThinMaterial,
        strokeOpacity: Double = 0.14,
        interactive: Bool = false
    ) -> some View {
        if #available(iOS 26.0, *) {
            if interactive {
                self.glassEffect(.regular.interactive(), in: shape)
            } else {
                self.glassEffect(.regular, in: shape)
            }
        } else {
            self
                .background(fallbackMaterial, in: shape)
                .overlay(
                    shape.stroke(Color.primary.opacity(strokeOpacity), lineWidth: 1)
                )
        }
    }
}

struct PressableScaleButtonStyle: ButtonStyle {
    var pressedScale: CGFloat = 0.96
    var pressedOpacity: Double = 0.85

    func makeBody(configuration: Configuration) -> some View {
        if #available(iOS 26.0, *) {
            configuration.label
        } else {
            configuration.label
                .scaleEffect(configuration.isPressed ? pressedScale : 1)
                .opacity(configuration.isPressed ? pressedOpacity : 1)
                .animation(.spring(response: 0.22, dampingFraction: 0.78), value: configuration.isPressed)
        }
    }
}

struct GlassIconLabel: View {
    let systemName: String
    let size: CGFloat
    var iconSize: CGFloat? = nil
    var weight: Font.Weight = .semibold
    var foreground: Color = Color(.label)
    var fallbackMaterial: Material = .thinMaterial
    var interactive: Bool = true

    var body: some View {
        let resolvedIconSize = iconSize ?? (size * 0.5)
        Image(systemName: systemName)
            .font(.system(size: resolvedIconSize, weight: weight))
            .foregroundStyle(foreground)
            .frame(width: size, height: size)
            .glassSurface(Circle(), fallbackMaterial: fallbackMaterial, interactive: interactive)
            .clipShape(Circle())
    }
}

struct GlassIconButton: View {
    let systemName: String
    let size: CGFloat
    var iconSize: CGFloat? = nil
    var weight: Font.Weight = .semibold
    var foreground: Color = Color(.label)
    var fallbackMaterial: Material = .thinMaterial
    let action: () -> Void

    var body: some View {
        let resolvedIconSize = iconSize ?? (size * 0.5)
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: resolvedIconSize, weight: weight))
                .foregroundStyle(foreground)
                .frame(width: size, height: size)
        }
        .buttonStyle(.plain)
        .glassSurface(Circle(), fallbackMaterial: fallbackMaterial, interactive: true)
        .clipShape(Circle())
        .contentShape(Circle())
    }
}

struct GlassIconMenu<Content: View>: View {
    let systemName: String
    let size: CGFloat
    var iconSize: CGFloat? = nil
    var weight: Font.Weight = .semibold
    var foreground: Color = Color(.label)
    var fallbackMaterial: Material = .thinMaterial
    let content: () -> Content

    init(
        systemName: String,
        size: CGFloat,
        iconSize: CGFloat? = nil,
        weight: Font.Weight = .semibold,
        foreground: Color = Color(.label),
        fallbackMaterial: Material = .thinMaterial,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.systemName = systemName
        self.size = size
        self.iconSize = iconSize
        self.weight = weight
        self.foreground = foreground
        self.fallbackMaterial = fallbackMaterial
        self.content = content
    }

    var body: some View {
        let resolvedIconSize = iconSize ?? (size * 0.5)
        Menu {
            content()
        } label: {
            Image(systemName: systemName)
                .font(.system(size: resolvedIconSize, weight: weight))
                .foregroundStyle(foreground)
                .frame(width: size, height: size)
        }
        .buttonStyle(.plain)
        .glassSurface(Circle(), fallbackMaterial: fallbackMaterial, interactive: true)
        .clipShape(Circle())
        .contentShape(Circle())
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

struct GlassEffectGroup<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer {
                content
            }
        } else {
            content
        }
    }
}
