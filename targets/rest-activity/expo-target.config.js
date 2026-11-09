/**
 * The rest between sets on the Lock Screen and in the Dynamic Island, built by
 * @bacons/apple-targets as a widget extension. Plain SwiftUI: no app group, no shared storage,
 * since SideStore renames app groups when it signs the app. Everything the widget shows comes
 * with the activity itself (see modules/rest-activity).
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'widget',
  name: 'RestActivity',
  displayName: 'Fuel',
  bundleIdentifier: '.restactivity',
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
};
