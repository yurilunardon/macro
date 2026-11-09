Pod::Spec.new do |s|
  s.name           = 'RestActivity'
  s.version        = '1.0.0'
  s.summary        = 'The rest between sets as a Live Activity'
  s.description    = 'Local module of the Macro app: starts, updates and ends the Live Activity drawn by the rest-activity widget target.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ActivityKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
