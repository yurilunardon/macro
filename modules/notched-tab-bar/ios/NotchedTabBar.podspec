Pod::Spec.new do |s|
  s.name           = 'NotchedTabBar'
  s.version        = '1.0.0'
  s.summary        = 'Tab bar in Liquid Glass with a cradle for a floating button'
  s.description    = 'Local module of the Macro app: a SwiftUI tab bar whose glass follows a notch around the calendar button.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
