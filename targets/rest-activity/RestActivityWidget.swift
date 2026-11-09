import ActivityKit
import SwiftUI
import WidgetKit

/// The same struct, field for field, as in modules/rest-activity/ios/RestActivityModule.swift:
/// ActivityKit pairs the app's activity with this widget by this type.
struct RestAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var startedAt: Date
    var endsAt: Date
    var label: String
  }

  var title: String
}

@main
struct FuelWidgets: WidgetBundle {
  var body: some Widget {
    RestLiveActivity()
  }
}

/// The app's green, the dark theme's accent: the Lock Screen is dark.
private let accent = Color(red: 0x30 / 255, green: 0xD1 / 255, blue: 0x58 / 255)

/// The rest between sets: its countdown, a bar emptying with it and what comes next. Both run by
/// themselves; when the rest is over the activity is stale and says so, until the next set.
struct RestLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RestAttributes.self) { context in
      LockScreenRest(state: context.state, title: context.attributes.title, over: context.isStale)
        .activityBackgroundTint(Color.black.opacity(0.55))
        .activitySystemActionForegroundColor(accent)
        .widgetURL(URL(string: "macro://workout"))
    } dynamicIsland: { context in
      let over = context.isStale
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          VStack(alignment: .leading, spacing: 2) {
            Text(over ? "RECUPERO FINITO" : "RECUPERO")
              .font(.caption2.weight(.semibold))
              .foregroundStyle(.secondary)
            Countdown(state: context.state, over: over)
              .font(.system(size: 34, weight: .bold, design: .rounded))
              .foregroundStyle(accent)
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.attributes.title)
            .font(.subheadline.weight(.semibold))
            .lineLimit(2)
            .multilineTextAlignment(.trailing)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 6) {
            RestBar(state: context.state, over: over)
            Text(context.state.label)
              .font(.footnote)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
          .padding(.horizontal, 4)
        }
      } compactLeading: {
        Image(systemName: over ? "checkmark.circle.fill" : "timer")
          .foregroundStyle(accent)
      } compactTrailing: {
        Countdown(state: context.state, over: over)
          .font(.callout.weight(.semibold))
          .foregroundStyle(accent)
          .frame(maxWidth: 52)
      } minimal: {
        Image(systemName: over ? "checkmark.circle.fill" : "timer")
          .foregroundStyle(accent)
      }
      .widgetURL(URL(string: "macro://workout"))
      .keylineTint(accent)
    }
  }
}

private struct LockScreenRest: View {
  let state: RestAttributes.ContentState
  let title: String
  let over: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text(over ? "RECUPERO FINITO" : "RECUPERO")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
          Countdown(state: state, over: over)
            .font(.system(size: 44, weight: .bold, design: .rounded))
            .foregroundStyle(accent)
        }
        Spacer(minLength: 12)
        VStack(alignment: .trailing, spacing: 2) {
          Text(title)
            .font(.headline)
            .lineLimit(2)
            .multilineTextAlignment(.trailing)
          Text(state.label)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(2)
            .multilineTextAlignment(.trailing)
        }
      }
      RestBar(state: state, over: over)
    }
    .padding(16)
  }
}

/// Counting down to the end of the rest, by itself; "Vai" once it is over.
private struct Countdown: View {
  let state: RestAttributes.ContentState
  let over: Bool

  var body: some View {
    if over || state.endsAt <= Date() {
      Text("Vai")
    } else {
      Text(timerInterval: state.startedAt...state.endsAt, countsDown: true)
        .monospacedDigit()
        .multilineTextAlignment(.leading)
    }
  }
}

/// A bar emptying as the rest goes, by itself; full once it is over.
private struct RestBar: View {
  let state: RestAttributes.ContentState
  let over: Bool

  var body: some View {
    if over || state.endsAt <= Date() {
      ProgressView(value: 1)
        .tint(accent)
    } else {
      ProgressView(timerInterval: state.startedAt...state.endsAt, countsDown: true) {
        EmptyView()
      } currentValueLabel: {
        EmptyView()
      }
      .tint(accent)
    }
  }
}
