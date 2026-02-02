# iOS 26 Liquid Glass (SwiftUI + UIKit)

Purpose: capture official Apple guidance for Liquid Glass behavior and how to use it in SwiftUI and UIKit.

## What Liquid Glass is and how it should behave

- Liquid Glass is adaptive: it continuously adjusts to the content behind it, shifting shadows and tint to keep controls legible and may switch light/dark to maintain contrast. Larger elements appear thicker with deeper shadows and stronger lensing/refraction to preserve readability. (Meet Liquid Glass)
- It forms a distinct, floating functional layer for controls and navigation that sits above content. (Meet Liquid Glass)
- Scroll edge effects work with Liquid Glass to maintain separation and legibility as content moves underneath, with a "hard" style when pinned accessory content needs stronger separation. (Meet Liquid Glass)

## Interaction expectations

- Interactive elements are expected to scale/bounce (and visually shimmer in SwiftUI) on touch. For custom glass, you must opt in to interactive behavior. (Build a SwiftUI app with the new design; Build a UIKit app with the new design)
- Use Liquid Glass sparingly for the most important elements. Prefer system controls and structures when possible. (Build a UIKit app with the new design)
- Glass cannot sample other glass; group nearby glass elements inside a container for consistent visuals and smooth morphing. (Build a SwiftUI app with the new design)

## Variants and tint

- Liquid Glass has two variants (Regular and Clear) with different characteristics and use cases; they should not be mixed. Use Clear only when it sits over media-rich content, a dimming layer will not harm the content, and the content placed above is bold/bright. (Meet Liquid Glass)
- Use tinting selectively to emphasize primary elements; avoid tinting everything. (Meet Liquid Glass)

## SwiftUI usage

### Automatic adoption

- Standard app structures and controls (TabView, NavigationSplitView, toolbars, search, standard controls) adopt the new design when built with Xcode 26. Favor these first. (Build a SwiftUI app with the new design)

### Custom Liquid Glass

- Apply `glassEffect` to a custom view. The default is a capsule shape; pass a shape to customize. (Build a SwiftUI app with the new design)
- Use `tint` only when it conveys meaning or emphasis. (Build a SwiftUI app with the new design)
- On iOS, add the `interactive` modifier for custom controls or containers that should scale/bounce/shimmer on interaction. (Build a SwiftUI app with the new design)
- Group related glass elements in `GlassEffectContainer` so they share a sampling region. Use `glassEffectID` with a shared namespace to enable fluid morphing between elements. (Build a SwiftUI app with the new design)

Example (pseudocode):

```swift
@Namespace private var glassNamespace

GlassEffectContainer {
    BadgeView()
        .glassEffect()
        .glassEffectID("badge", in: glassNamespace)
        .interactive() // iOS
}
```

## UIKit usage

### Automatic adoption

- UIKit components gain the new Liquid Glass appearance when you rebuild with the latest SDK. (Build a UIKit app with the new design)

### Custom Liquid Glass

- Use `UIVisualEffectView` with `UIGlassEffect` to add glass to custom views. (Build a UIKit app with the new design)
- Set `UIGlassEffect.isInteractive = true` to get the expected interactive scaling/bounce for custom glass controls. (Build a UIKit app with the new design)
- Use `UIGlassContainerEffect` to group multiple glass elements and keep their appearance consistent. (Build a UIKit app with the new design)

Example (pseudocode):

```swift
let glassEffect = UIGlassEffect()
let glassView = UIVisualEffectView(effect: glassEffect)

// Enable interactive behavior (scale/bounce)
glassEffect.isInteractive = true

// Group multiple glass views in a container
let container = UIGlassContainerEffect()
let containerView = UIVisualEffectView(effect: container)
containerView.contentView.addSubview(glassView)
```

## Accessibility

- Liquid Glass responds to accessibility settings like Reduced Transparency, Increased Contrast, and Reduced Motion automatically. Design with these adaptations in mind. (Meet Liquid Glass)

## References (official Apple sources)

- WWDC25: Meet Liquid Glass
- WWDC25: Build a SwiftUI app with the new design
- WWDC25: Build a UIKit app with the new design
