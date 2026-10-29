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
  /// The tab on screen: "left", "right", or anything else for none.
  @Field var selected: String = "left"
  /// Today on the calendar's button, as on the Calendar app's icon.
  @Field var weekday: String = ""
  @Field var day: String = ""
  @Field var accent: Color = .green
  /// While a finger is down on the calendar's button. React Native handles that touch, so the
  /// calendar can grow out of the button.
  @Field var calendarPressed: Bool = false
  /// `{ tab: "left" | "right" }` when a tab is picked.
  var onSelect = EventDispatcher()
}

/// Sizes shared with the JavaScript side (modules/notched-tab-bar/src/NotchedTabBarView.ts).
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
  /// The lens under the tab on screen, a little inside the capsule, and a little more air
  /// between it and the cradle.
  static let lensInset: CGFloat = 4
  static let cradleGap: CGFloat = 2
  /// Glass this close together melts into one piece: the lens and the button, once the lens is
  /// this near the middle.
  static let melt: CGFloat = 20
  static let meltZone: CGFloat = 36
  /// How far the button rises above the capsule: the view is `rise + bar` tall.
  static var rise: CGFloat { fab / 2 - fabSink }
  static var cradleRadius: CGFloat { fab / 2 + cradleMargin }
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

/// The lens: a capsule as tall as the inside of the bar, with the cradle (grown by the same
/// inset, and a little air) cut out of it. It fills all the room there is, so the part passing
/// under the button flattens into the channel there while the rest stays full height, like
/// liquid poured through. It spans `from` to `to`, stretched when a tab pulls it.
struct LensShape: Shape {
  var from: CGFloat
  var to: CGFloat
  var slot: CGFloat

  /// The bar's outline, the same inset in from every edge.
  private static let inside = NotchedCapsule(
    sink: Metrics.fabSink - Metrics.lensInset,
    radius: Metrics.cradleRadius + Metrics.lensInset + Metrics.cradleGap,
    shoulder: Metrics.shoulder - Metrics.lensInset)

  func path(in rect: CGRect) -> Path {
    let room = rect.insetBy(dx: Metrics.lensInset, dy: Metrics.lensInset)
    let left = min(from, to) - slot / 2
    let lens = CGRect(x: left, y: room.minY, width: abs(to - from) + slot, height: room.height)
    let capsule = CGPath(
      roundedRect: lens, cornerWidth: room.height / 2, cornerHeight: room.height / 2, transform: nil)
    return Path(capsule.intersection(Self.inside.path(in: room).cgPath))
  }
}

/// The lens and the calendar's button, drawn frame by frame as the lens moves, so it flows
/// through the channel while it springs from one tab to the other, not only under a finger.
struct LensLayer<CalendarButton: View>: View, Animatable {
  var center: CGFloat
  var width: CGFloat
  var height: CGFloat
  var slot: CGFloat
  var tint: Color
  var shown: Bool
  var button: CalendarButton

  var animatableData: CGFloat {
    get { center }
    set { center = newValue }
  }

  var body: some View {
    let rest = Metrics.lensInset + slot / 2
    let near = center < width / 2 ? rest : width - rest
    let pulled = Self.magnet(center, to: near, range: slot * 0.6)
    // The lens melts into the button only near the middle; on the way it keeps clear of it.
    let middle = 1 - min(abs(pulled - width / 2) / Metrics.meltZone, 1)
    let melt = Metrics.melt * middle * middle * (3 - 2 * middle)
    return GlassGroup(spacing: melt) {
      ZStack(alignment: .topLeading) {
        Color.clear
          .frame(width: width, height: Metrics.bar)
          .barGlass(in: LensShape(from: center, to: pulled, slot: slot), tint: tint)
          .position(x: width / 2, y: Metrics.rise + Metrics.bar / 2)
          .opacity(shown ? 1 : 0)
        button
          .position(x: width / 2, y: Metrics.fab / 2)
      }
      .frame(width: width, height: height, alignment: .topLeading)
    }
  }

  /// Near a tab the lens is drawn to it like a magnet: it runs ahead to the tab and stays
  /// stretched back to where it would be.
  private static func magnet(_ center: CGFloat, to rest: CGFloat, range: CGFloat) -> CGFloat {
    let offset = center - rest
    guard abs(offset) < range else { return center }
    return rest + offset * abs(offset) / range
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

  private let shape = NotchedCapsule(sink: Metrics.fabSink, radius: Metrics.cradleRadius, shoulder: Metrics.shoulder)

  var body: some View {
    GeometryReader { geometry in
      let width = geometry.size.width
      // Each tab has the capsule's end up to the cradle, less a little air.
      let slot = max(width / 2 - shape.reach - 2 * Metrics.lensInset, 44)
      ZStack(alignment: .topLeading) {
        // The capsule's glass, with the cradle.
        Color.clear
          .frame(width: width, height: Metrics.bar)
          .barGlass(in: shape, tint: nil)
          .position(x: width / 2, y: Metrics.rise + Metrics.bar / 2)

        // The lens and the button in one container, so their glass melts together when the lens
        // passes under the cradle.
        lensLayer(width: width, height: geometry.size.height, slot: slot)

        tabs(width: width, slot: slot)
          .position(x: width / 2, y: Metrics.rise + Metrics.bar / 2)
      }
      .frame(width: width, height: geometry.size.height, alignment: .topLeading)
    }
  }

  // MARK: The lens

  private var selectedSide: Side? { Side(rawValue: props.selected) }

  private func lensLayer(width: CGFloat, height: CGFloat, slot: CGFloat) -> some View {
    let restLeft = Metrics.lensInset + slot / 2
    let restRight = width - restLeft
    let center: CGFloat
    if let dragX {
      center = min(max(dragX, restLeft), restRight)
    } else {
      center = selectedSide == .right ? restRight : restLeft
    }
    let lifted = dragX != nil
    return LensLayer(
      center: center, width: width, height: height, slot: slot,
      tint: Color.primary.opacity(lifted ? 0.06 : 0.1), shown: lifted || selectedSide != nil,
      button: calendarButton
    )
    .animation(
      lifted ? .interactiveSpring(response: 0.2, dampingFraction: 0.85) : .spring(response: 0.5, dampingFraction: 0.72),
      value: center)
    .animation(.easeOut(duration: 0.2), value: lifted)
    .allowsHitTesting(false)
  }

  // MARK: The tabs

  private func tabs(width: CGFloat, slot: CGFloat) -> some View {
    HStack(spacing: 0) {
      tab(.left).frame(width: slot)
      Spacer(minLength: 0)
      tab(.right).frame(width: slot)
    }
    .padding(.horizontal, Metrics.lensInset)
    .frame(width: width, height: Metrics.bar)
    .contentShape(shape)
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
            select(side)
          }
        }
    )
  }

  private func tab(_ side: Side) -> some View {
    let label = side == .left ? props.leftLabel : props.rightLabel
    let icon = side == .left ? props.leftIcon : props.rightIcon
    let selectedIcon = (side == .left ? props.leftSelectedIcon : props.rightSelectedIcon) ?? icon
    // The tab under a sliding finger lights up before the finger lifts.
    let on = (hovered ?? selectedSide) == side
    return Button {
      select(side)
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
      .animation(.easeOut(duration: 0.15), value: on)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
    .accessibilityAddTraits(selectedSide == side ? [.isSelected, .isButton] : .isButton)
  }

  // MARK: The calendar's button

  /// Drawn only: React Native lays a transparent button over it, which the calendar grows out of.
  private var calendarButton: some View {
    VStack(spacing: 0) {
      Text(props.weekday)
        .font(.system(size: 10, weight: .bold))
        .kerning(0.8)
        .foregroundStyle(props.accent)
      Text(props.day)
        .font(.system(size: 24, weight: .semibold))
        .monospacedDigit()
        .foregroundStyle(Color.primary)
    }
    .frame(width: Metrics.fab, height: Metrics.fab)
    .barGlass(in: Circle(), tint: nil)
    .scaleEffect(props.calendarPressed ? 0.9 : 1)
    .animation(.spring(response: 0.3, dampingFraction: 0.6), value: props.calendarPressed)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  private func select(_ side: Side) {
    props.onSelect(["tab": side.rawValue])
  }
}

/// A `GlassEffectContainer` where the system has Liquid Glass; the content as it is otherwise.
struct GlassGroup<Content: View>: View {
  var spacing: CGFloat
  @ViewBuilder var content: () -> Content

  var body: some View {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      GlassEffectContainer(spacing: spacing) {
        content()
      }
    } else {
      content()
    }
    #else
    content()
    #endif
  }
}

extension View {
  /// Liquid Glass in a shape; a material where the system has no glass.
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
      self.background(.ultraThinMaterial, in: shape).background(tint, in: shape)
    } else {
      self.background(.ultraThinMaterial, in: shape)
    }
  }
}

#if compiler(>=6.2)
@available(iOS 26.0, *)
private func barGlassStyle(_ tint: Color?) -> Glass {
  tint.map { Glass.regular.tint($0) } ?? Glass.regular
}
#endif
