Pod::Spec.new do |s|
  s.name = 'OneCarPlay'
  s.version = '1.0.0'
  s.summary = 'Native Apple CarPlay and full-duplex 24kHz PCM16 voice audio engine for One.'
  s.author = 'Jason Roell'
  s.homepage = 'https://github.com/jroell/one'
  s.platform = :ios, '18.0'
  s.source = { :path => '.' }
  s.static_framework = true
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.frameworks = 'AVFoundation', 'MediaPlayer', 'UIKit'
  s.weak_frameworks = 'CarPlay'
end
