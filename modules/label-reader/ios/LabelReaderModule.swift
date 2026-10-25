import ExpoModulesCore
import ImageIO
import Vision

/// Reads the text in a photo with Apple's Vision framework, on the device.
public class LabelReaderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LabelReader")

    /// Returns every recognised piece of text with its box, normalised to 0…1 with the origin at
    /// the top left of the upright image.
    AsyncFunction("recognizeText") { (uri: URL, promise: Promise) in
      guard let source = CGImageSourceCreateWithURL(uri as CFURL, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        promise.reject("ERR_LABEL_IMAGE", "Impossibile leggere la foto")
        return
      }
      // Camera photos are stored sideways with an orientation tag; Vision needs it to read them.
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
      let rawOrientation = properties?[kCGImagePropertyOrientation] as? UInt32 ?? 1
      let orientation = CGImagePropertyOrientation(rawValue: rawOrientation) ?? .up

      DispatchQueue.global(qos: .userInitiated).async {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["it-IT", "en-US"]
        // Labels are mostly numbers and short words: language correction would "fix" them.
        request.usesLanguageCorrection = false

        let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
        do {
          try handler.perform([request])
          let boxes: [[String: Any]] = (request.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return [
              "text": candidate.string,
              "x": Double(box.minX),
              "y": Double(1 - box.maxY),
              "width": Double(box.width),
              "height": Double(box.height),
            ]
          }
          promise.resolve(boxes)
        } catch {
          promise.reject("ERR_LABEL_VISION", error.localizedDescription)
        }
      }
    }
  }
}
