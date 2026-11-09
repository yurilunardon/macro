import ActivityKit
import ExpoModulesCore

/// The rest between sets, on the Lock Screen and in the Dynamic Island. The same struct, field for
/// field, is in targets/rest-activity/RestActivityWidget.swift: ActivityKit pairs the app's
/// activity with the widget that draws it by this type.
struct RestAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// When the rest began, as the start of the bar; moved with ±15 s so the bar keeps its length.
    var startedAt: Date
    var endsAt: Date
    /// "Prossima serie: Panca piana · 3".
    var label: String
  }

  /// The workout's name.
  var title: String
}

/// Starts, changes and ends the rest's Live Activity. The countdown runs by itself in the widget
/// (a timer text), so nothing has to be sent while the phone is locked; once the rest is over the
/// activity goes stale and the widget says so.
public class RestActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RestActivity")

    Function("isEnabled") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Times in milliseconds since 1970, as JS keeps them.
    Function("show") { (title: String, label: String, startedAt: Double, endsAt: Double) in
      let state = RestAttributes.ContentState(
        startedAt: Date(timeIntervalSince1970: startedAt / 1000),
        endsAt: Date(timeIntervalSince1970: endsAt / 1000),
        label: label
      )
      let content = ActivityContent(state: state, staleDate: state.endsAt)
      let running = Activity<RestAttributes>.activities
      Task {
        if let current = running.first {
          await current.update(content)
          // One at a time: any other left over from before is ended.
          for other in running.dropFirst() {
            await other.end(nil, dismissalPolicy: .immediate)
          }
        } else {
          _ = try? Activity.request(attributes: RestAttributes(title: title), content: content, pushType: nil)
        }
      }
    }

    Function("hide") { () in
      let running = Activity<RestAttributes>.activities
      Task {
        for activity in running {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
    }
  }
}
