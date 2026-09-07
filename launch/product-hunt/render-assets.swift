import AppKit
import Foundation

guard CommandLine.arguments.count == 6 else {
  fputs("usage: render-assets.swift <social|gallery|thumbnail> input output title subtitle\n", stderr)
  exit(2)
}

let mode = CommandLine.arguments[1]
let inputPath = CommandLine.arguments[2]
let outputPath = CommandLine.arguments[3]
let title = CommandLine.arguments[4]
let subtitle = CommandLine.arguments[5]
let canvas = mode == "thumbnail" ? NSSize(width: 240, height: 240) : mode == "social" ? NSSize(width: 1200, height: 630) : NSSize(width: 1270, height: 760)

guard let source = NSImage(contentsOfFile: inputPath),
      let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: Int(canvas.width),
        pixelsHigh: Int(canvas.height),
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
      ),
      let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
  fputs("could not prepare image\n", stderr)
  exit(3)
}

func font(_ name: String, _ size: CGFloat, weight: NSFont.Weight) -> NSFont {
  NSFont(name: name, size: size) ?? NSFont.systemFont(ofSize: size, weight: weight)
}

func aspectFill(_ image: NSImage, in rect: NSRect) {
  let sourceSize = image.size
  let scale = max(rect.width / sourceSize.width, rect.height / sourceSize.height)
  let drawSize = NSSize(width: sourceSize.width * scale, height: sourceSize.height * scale)
  let drawRect = NSRect(x: rect.midX - drawSize.width / 2, y: rect.midY - drawSize.height / 2, width: drawSize.width, height: drawSize.height)
  image.draw(in: drawRect, from: .zero, operation: .sourceOver, fraction: 1)
}

func drawText(_ text: String, in rect: NSRect, using textFont: NSFont, color: NSColor, alignment: NSTextAlignment = .left) {
  let paragraph = NSMutableParagraphStyle()
  paragraph.alignment = alignment
  paragraph.lineBreakMode = .byWordWrapping
  (text as NSString).draw(in: rect, withAttributes: [.font: textFont, .foregroundColor: color, .paragraphStyle: paragraph])
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high

if mode == "thumbnail" {
  aspectFill(source, in: NSRect(origin: .zero, size: canvas))
} else if mode == "social" {
  aspectFill(source, in: NSRect(origin: .zero, size: canvas))
  let veil = NSGradient(colors: [NSColor(calibratedWhite: 0.03, alpha: 0.72), NSColor(calibratedWhite: 0.03, alpha: 0.02)])!
  veil.draw(in: NSRect(origin: .zero, size: canvas), angle: 0)
  drawText("FREE PUBLIC BETA  ·  ENGLISH + HINGLISH", in: NSRect(x: 76, y: 405, width: 600, height: 34), using: font("Avenir Next Demi Bold", 17, weight: .semibold), color: NSColor(calibratedRed: 1, green: 0.57, blue: 0.48, alpha: 1))
  drawText(title, in: NSRect(x: 72, y: 266, width: 560, height: 140), using: font("Georgia", 96, weight: .medium), color: .white)
  drawText(subtitle, in: NSRect(x: 78, y: 176, width: 570, height: 80), using: font("Avenir Next", 27, weight: .regular), color: NSColor(calibratedWhite: 1, alpha: 0.88))
} else if mode == "gallery" {
  NSColor(calibratedRed: 0.09, green: 0.07, blue: 0.09, alpha: 1).setFill()
  NSBezierPath(rect: NSRect(origin: .zero, size: canvas)).fill()
  drawText(title, in: NSRect(x: 60, y: 681, width: 1150, height: 55), using: font("Georgia", 39, weight: .medium), color: .white, alignment: .center)
  drawText(subtitle, in: NSRect(x: 80, y: 646, width: 1110, height: 28), using: font("Avenir Next", 16, weight: .regular), color: NSColor(calibratedWhite: 1, alpha: 0.68), alignment: .center)
  let frame = NSRect(x: 74, y: 20, width: 1122, height: 631)
  NSColor(calibratedWhite: 1, alpha: 0.12).setStroke()
  let border = NSBezierPath(roundedRect: frame.insetBy(dx: -1, dy: -1), xRadius: 18, yRadius: 18)
  border.lineWidth = 2
  border.stroke()
  NSGraphicsContext.saveGraphicsState()
  NSBezierPath(roundedRect: frame, xRadius: 16, yRadius: 16).addClip()
  aspectFill(source, in: frame)
  NSGraphicsContext.restoreGraphicsState()
} else {
  fputs("unknown mode\n", stderr)
  exit(4)
}

context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
  fputs("could not encode png\n", stderr)
  exit(5)
}
try png.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
