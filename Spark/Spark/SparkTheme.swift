import SwiftUI

// Shared design system for the Spark iOS app
enum SparkPalette {
  static let background = Color(red: 13 / 255, green: 15 / 255, blue: 24 / 255)
  static let surface = Color(red: 22 / 255, green: 26 / 255, blue: 39 / 255)
  static let surfaceElevated = Color(red: 31 / 255, green: 36 / 255, blue: 54 / 255)
  static let accent = Color("AccentColor")
  static let accentSecondary = Color(red: 110 / 255, green: 173 / 255, blue: 255 / 255)
  static let accentTertiary = Color(red: 84 / 255, green: 232 / 255, blue: 196 / 255)
  static let warning = Color(red: 255 / 255, green: 169 / 255, blue: 135 / 255)
  static let success = Color(red: 120 / 255, green: 231 / 255, blue: 180 / 255)
  static let neutral = Color(red: 142 / 255, green: 152 / 255, blue: 167 / 255)
  static let textPrimary = Color.white
  static let textSecondary = Color.white.opacity(0.7)
  static let outline = Color.white.opacity(0.12)
}

enum SparkGradient {
  static let hero = LinearGradient(
    colors: [SparkPalette.accent, SparkPalette.accentSecondary],
    startPoint: .topLeading,
    endPoint: .bottomTrailing
  )

  static let glow = LinearGradient(
    colors: [SparkPalette.accentSecondary.opacity(0.8), SparkPalette.accent.opacity(0.3)],
    startPoint: .top,
    endPoint: .bottom
  )

  static let focus = LinearGradient(
    colors: [SparkPalette.accentTertiary, SparkPalette.accentSecondary.opacity(0.8)],
    startPoint: .topLeading,
    endPoint: .bottomTrailing
  )

  static let timed = LinearGradient(
    colors: [SparkPalette.warning.opacity(0.85), SparkPalette.accentSecondary.opacity(0.7)],
    startPoint: .topLeading,
    endPoint: .bottomTrailing
  )

  static let revisit = LinearGradient(
    colors: [SparkPalette.success.opacity(0.9), SparkPalette.accent.opacity(0.7)],
    startPoint: .topLeading,
    endPoint: .bottomTrailing
  )
}

enum SparkStyle {
  static let cornerRadius: CGFloat = 24
  static let cardPadding: CGFloat = 20
  static let verticalSpacing: CGFloat = 16
  static let horizontalSpacing: CGFloat = 16

  static func cardShadow(color: Color = .black.opacity(0.25)) -> SparkShadowModifier {
    SparkShadowModifier(color: color, radius: 30, x: 0, y: 18)
  }
}

struct SparkShadowModifier: ViewModifier {
  let color: Color
  let radius: CGFloat
  let x: CGFloat
  let y: CGFloat

  func body(content: Content) -> some View {
    content.shadow(color: color, radius: radius, x: x, y: y)
  }
}

enum SparkTypography {
  static func heading(_ text: Text) -> some View {
    text
      .font(.system(size: 34, weight: .bold, design: .rounded))
      .foregroundColor(SparkPalette.textPrimary)
  }

  static func title(_ text: Text) -> some View {
    text
      .font(.system(size: 24, weight: .semibold, design: .rounded))
      .foregroundColor(SparkPalette.textPrimary)
  }

  static func subtitle(_ text: Text) -> some View {
    text
      .font(.system(size: 16, weight: .medium, design: .rounded))
      .foregroundColor(SparkPalette.textSecondary)
  }

  static func label(_ text: Text) -> some View {
    text
      .font(.system(size: 14, weight: .medium, design: .rounded))
      .foregroundColor(SparkPalette.textSecondary)
  }

  static func caption(_ text: Text) -> some View {
    text
      .font(.system(size: 12, weight: .regular, design: .rounded))
      .foregroundColor(SparkPalette.textSecondary.opacity(0.9))
  }
}

enum SparkConstants {
  static let appName = "Spark"
  static let slogan = "Scan. Practice. GCSE Science."
}

struct SparkGlassCard<Content: View>: View {
  let gradient: LinearGradient?
  let content: Content

  init(gradient: LinearGradient? = nil, @ViewBuilder content: () -> Content) {
    self.gradient = gradient
    self.content = content()
  }

  var body: some View {
    ZStack {
      if let gradient {
        RoundedRectangle(cornerRadius: SparkStyle.cornerRadius, style: .continuous)
          .fill(gradient)
          .opacity(0.75)
      }

      RoundedRectangle(cornerRadius: SparkStyle.cornerRadius, style: .continuous)
        .fill(SparkPalette.surface)
        .opacity(gradient == nil ? 1 : 0.9)

      RoundedRectangle(cornerRadius: SparkStyle.cornerRadius, style: .continuous)
        .stroke(SparkPalette.outline)

      content
        .padding(SparkStyle.cardPadding)
    }
    .background(
      RoundedRectangle(cornerRadius: SparkStyle.cornerRadius, style: .continuous)
        .fill(Color.clear)
    )
    .modifier(SparkStyle.cardShadow())
  }
}
