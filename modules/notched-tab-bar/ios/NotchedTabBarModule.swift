import ExpoModulesCore
import SwiftUI
import UIKit

/// The app's tab bar, drawn in SwiftUI so its Liquid Glass can take any shape: a capsule with
/// a round cradle in the middle of its top edge, where the calendar's button floats.
public class NotchedTabBarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NotchedTabBar")

    View(NotchedTabBarView.self)
  }
}

public final class NotchedTabBarProps: ExpoSwiftUI.ViewProps {
  @Field var leftLabel: String = ""
  @Field var leftIcon: String = "circle"
  @Field var leftSelectedIcon: String?
  @Field var rightLabel: String = ""
  @Field var rightIcon: String = "circle"
  @Field var rightSelectedIcon: String?
  /// The button on screen: "left", "right", "calendar", or anything else for none.
  @Field var selected: String = "left"
  /// Today on the calendar's button, as on the Calendar app's icon.
  @Field var weekday: String = ""
  @Field var day: String = ""
  @Field var accent: Color = .green
  /// `{ tab: "left" | "right" | "calendar" }` when a button is picked.
  var onSelect = EventDispatcher()
}

/// Sizes shared with the JavaScript side (modules/notched-tab-bar/index.ts).
private enum Metrics {
  /// The capsule, as tall as iOS's own tab bar.
  static let bar: CGFloat = 62
  /// The calendar's button, the air around it in the cradle, and how far its centre sits below
  /// the capsule's top edge.
  static let fab: CGFloat = 60
  static let cradleMargin: CGFloat = 6
  static let fabSink: CGFloat = 4
  /// The rounding where the top edge turns down into the cradle.
  static let shoulder: CGFloat = 10
  /// The lens under the tab on screen, a little inside the capsule.
  static let lensInset: CGFloat = 4
  /// How far the button rises above the capsule: the view is `rise + bar` tall.
  static var rise: CGFloat { fab / 2 - fabSink }
}

private enum Side: String {
  case left
  case right
}

/// A capsule with a round cradle cut into the middle of its top edge, with rounded shoulders.
struct NotchedCapsule: Shape {
  /// How far below the top edge the cradle's centre is, and its radius.
  var sink: CGFloat
  var radius: CGFloat
  /// The radius of the rounding between the top edge and the cradle.
  var shoulder: CGFloat

  /// Half the width of the opening along the top edge, from the middle to each shoulder's centre.
  var reach: CGFloat {
    let hypotenuse = radius + shoulder
    let rise = shoulder - sink
    return (max(hypotenuse * hypotenuse - rise * rise, 0)).squareRoot()
  }

  func path(in rect: CGRect) -> Path {
    let end = rect.height / 2
    let top = rect.minY
    let cradle = CGPoint(x: rect.midX, y: top + sink)
    // Each shoulder is a small circle touching the top edge from below and the cradle from outside.
    let leftShoulder = CGPoint(x: rect.midX - reach, y: top + shoulder)
    let rightShoulder = CGPoint(x: rect.midX + reach, y: top + shoulder)

    var path = Path()
    path.move(to: CGPoint(x: rect.minX + end, y: top))
    path.addLine(to: CGPoint(x: leftShoulder.x, y: top))
    // Angles grow clockwise on screen, where y points down; `clockwise: false` follows them.
    path.addArc(
      center: leftShoulder, radius: shoulder,
      startAngle: .degrees(-90), endAngle: angle(from: leftShoulder, to: cradle), clockwise: false)
    // Down and round the bottom of the cradle, against the clock on screen.
    path.addArc(
      center: cradle, radius: radius,
      startAngle: angle(from: cradle, to: leftShoulder), endAngle: angle(from: cradle, to: rightShoulder), clockwise: true)
    path.addArc(
      center: rightShoulder, radius: shoulder,
      startAngle: angle(from: rightShoulder, to: cradle), endAngle: .degrees(-90), clockwise: false)
    path.addLine(to: CGPoint(x: rect.maxX - end, y: top))
    path.addArc(
      center: CGPoint(x: rect.maxX - end, y: top + end), radius: end,
      startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: false)
    path.addLine(to: CGPoint(x: rect.minX + end, y: rect.maxY))
    path.addArc(
      center: CGPoint(x: rect.minX + end, y: top + end), radius: end,
      startAngle: .degrees(90), endAngle: .degrees(270), clockwise: false)
    path.closeSubpath()
    return path
  }

  private func angle(from: CGPoint, to: CGPoint) -> Angle {
    .radians(Double(atan2(to.y - from.y, to.x - from.x)))
  }
}

struct NotchedTabBarView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject var props: NotchedTabBarProps
  /// Where a finger sliding along the capsule is, and the tab under it.
  @State private var dragX: CGFloat?
  @State private var hovered: Side?

  init(props: NotchedTabBarProps) {
    self.props = props
  }

  private let shape = NotchedCapsule(
    sink: Metrics.fabSink, radius: Metrics.fab / 2 + Metrics.cradleMargin, shoulder: Metrics.shoulder)

  var body: some View {
    GeometryReader { geometry in
      let width = geometry.size.width
      ZStack(alignment: .top) {
        bar(width: width)
          .padding(.top, Metrics.rise)
        calendarButton
      }
      .frame(width: width, height: geometry.size.height, alignment: .top)
    }
  }

  // MARK: The capsule

  private func bar(width: CGFloat) -> some View {
    // Each tab has the capsule's end up to the cradle, less a little air.
    let slot = max(width / 2 - shape.reach - 2 * Metrics.lensInset, 44)
    let rest: [Side: CGFloat] = [.left: Metrics.lensInset, .right: width - Metrics.lensInset - slot]
    let selectedSide = Side(rawValue: props.selected)
    let lensX: CGFloat
    if let dragX {
      lensX = min(max(dragX - slot / 2, rest[.left] ?? 0), rest[.right] ?? 0)
    } else {
      lensX = rest[selectedSide ?? .left] ?? 0
    }
    let lensShown = dragX != nil || selectedSide != nil

    return ZStack(alignment: .leading) {
      Capsule()
        .fill(Color.primary.opacity(0.1))
        .frame(width: slot, height: Metrics.bar - 2 * Metrics.lensInset)
        .scaleEffect(dragX == nil ? 1 : 1.06)
        .offset(x: lensX)
        .opacity(lensShown ? 1 : 0)
        .animation(
          dragX == nil ? .spring(response: 0.38, dampingFraction: 0.78) : .interactiveSpring(response: 0.18, dampingFraction: 0.9),
          value: lensX)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: lensShown)
      HStack(spacing: 0) {
        tab(.left).frame(width: slot)
        Spacer(minLength: 0)
        tab(.right).frame(width: slot)
      }
      .padding(.horizontal, Metrics.lensInset)
    }
    .frame(width: width, height: Metrics.bar)
    // The lens slides from one tab to the other under the cradle.
    .clipShape(shape)
    .contentShape(shape)
    .barGlass(in: shape, tint: nil)
    .simultaneousGesture(
      DragGesture(minimumDistance: 6)
        .onChanged { value in
          dragX = value.location.x
          let side: Side = value.location.x < width / 2 ? .left : .right
          if hovered != side {
            hovered = side
            UISelectionFeedbackGenerator().selectionChanged()
          }
        }
        .onEnded { value in
          let side: Side = value.location.x < width / 2 ? .left : .right
          let moved = abs(value.translation.width) >= 12
          dragX = nil
          hovered = nil
          // A short slide is a tap, which the tab's button already reports.
          if moved {
            select(side.rawValue)
          }
        }
    )
  }

  private func tab(_ side: Side) -> some View {
    let label = side == .left ? props.leftLabel : props.rightLabel
    let icon = side == .left ? props.leftIcon : props.rightIcon
    let selectedIcon = (side == .left ? props.leftSelectedIcon : props.rightSelectedIcon) ?? icon
    let on = props.selected == side.rawValue
    return Button {
      select(side.rawValue)
    } label: {
      VStack(spacing: 2) {
        Image(systemName: on ? selectedIcon : icon)
          .font(.system(size: 20, weight: .semibold))
          .frame(height: 24)
        Text(label)
          .font(.system(size: 10, weight: .semibold))
          .lineLimit(1)
      }
      .foregroundStyle(on ? props.accent : Color.primary)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
    .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
  }

  // MARK: The calendar's button

  private var calendarButton: some View {
    Button {
      select("calendar")
    } label: {
      VStack(spacing: 0) {
        Text(props.weekday)
          .font(.system(size: 10, weight: .bold))
          .kerning(0.8)
          .opacity(0.9)
        Text(props.day)
          .font(.system(size: 24, weight: .bold))
          .monospacedDigit()
      }
      .foregroundStyle(Color.white)
      .frame(width: Metrics.fab, height: Metrics.fab)
      .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .barGlass(in: Circle(), tint: props.accent)
    .overlay {
      // The calendar on screen: a thin white ring inside its circle.
      if props.selected == "calendar" {
        Circle()
          .inset(by: 4)
          .stroke(Color.white.opacity(0.6), lineWidth: 2)
          .allowsHitTesting(false)
      }
    }
    .accessibilityLabel("Calendario")
  }

  private func select(_ tab: String) {
    props.onSelect(["tab": tab])
  }
}

extension View {
  /// Liquid Glass in a shape, reacting to touches; a material where the system has no glass.
  @ViewBuilder
  fileprivate func barGlass<S: Shape>(in shape: S, tint: Color?) -> some View {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      self.glassEffect(barGlassStyle(tint), in: shape)
    } else {
      self.solidBackground(in: shape, tint: tint)
    }
    #else
    self.solidBackground(in: shape, tint: tint)
    #endif
  }

  @ViewBuilder
  fileprivate func solidBackground<S: Shape>(in shape: S, tint: Color?) -> some View {
    if let tint {
      self.background(tint, in: shape)
    } else {
      self.background(.ultraThinMaterial, in: shape)
    }
  }
}

#if compiler(>=6.2)
@available(iOS 26.0, *)
private func barGlassStyle(_ tint: Color?) -> Glass {
  let glass = tint.map { Glass.regular.tint($0) } ?? Glass.regular
  return glass.interactive()
}
#endif
