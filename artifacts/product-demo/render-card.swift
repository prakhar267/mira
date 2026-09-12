import AppKit
import Foundation

guard CommandLine.arguments.count == 7 else {
    fputs("usage: render-card.swift input output mode tag headline detail\n", stderr)
    exit(2)
}

let inputPath = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]
let mode = CommandLine.arguments[3]
let tag = CommandLine.arguments[4]
let headline = CommandLine.arguments[5]
let detail = CommandLine.arguments[6]
let canvas = NSSize(width: 1920, height: 1080)

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
      ) else {
    fputs("could not prepare image\n", stderr)
    exit(3)
}

func font(_ name: String, _ size: CGFloat, fallbackWeight: NSFont.Weight) -> NSFont {
    NSFont(name: name, size: size) ?? NSFont.systemFont(ofSize: size, weight: fallbackWeight)
}

func drawText(_ text: String, in rect: NSRect, using textFont: NSFont, color: NSColor, alignment: NSTextAlignment = .left) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = alignment
    paragraph.lineBreakMode = .byWordWrapping
    (text as NSString).draw(
        in: rect,
        withAttributes: [
            .font: textFont,
            .foregroundColor: color,
            .paragraphStyle: paragraph,
            .kern: 0.2
        ]
    )
}

NSGraphicsContext.saveGraphicsState()
guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fputs("could not create drawing context\n", stderr)
    exit(4)
}
NSGraphicsContext.current = context
context.imageInterpolation = .high

source.draw(in: NSRect(origin: .zero, size: canvas), from: .zero, operation: .copy, fraction: 1)

if mode == "scene" {
    NSColor(calibratedRed: 0.09, green: 0.065, blue: 0.058, alpha: 0.88).setFill()
    NSBezierPath(roundedRect: NSRect(x: 78, y: 84, width: 1040, height: 248), xRadius: 28, yRadius: 28).fill()
    drawText(tag.uppercased(), in: NSRect(x: 120, y: 264, width: 920, height: 34), using: font("Arial Bold", 24, fallbackWeight: .bold), color: NSColor(calibratedRed: 0.94, green: 0.49, blue: 0.42, alpha: 1))
    drawText(headline, in: NSRect(x: 120, y: 182, width: 930, height: 66), using: font("Arial Bold", 48, fallbackWeight: .bold), color: NSColor(calibratedRed: 1, green: 0.98, blue: 0.96, alpha: 1))
    drawText(detail, in: NSRect(x: 120, y: 116, width: 920, height: 46), using: font("Avenir", 27, fallbackWeight: .regular), color: NSColor(calibratedRed: 0.95, green: 0.86, blue: 0.83, alpha: 1))
} else {
    NSColor(calibratedRed: 0.07, green: 0.045, blue: 0.04, alpha: mode == "intro" ? 0.54 : 0.60).setFill()
    NSBezierPath(rect: NSRect(origin: .zero, size: canvas)).fill()
    drawText(headline, in: NSRect(x: 220, y: 570, width: 1480, height: 150), using: font("Arial Bold", mode == "intro" ? 112 : 90, fallbackWeight: .bold), color: NSColor(calibratedRed: 1, green: 0.97, blue: 0.95, alpha: 1), alignment: .center)
    drawText(detail, in: NSRect(x: 250, y: 470, width: 1420, height: 66), using: font("Avenir", 40, fallbackWeight: .regular), color: NSColor(calibratedRed: 1, green: 0.90, blue: 0.86, alpha: 1), alignment: .center)
    drawText(tag, in: NSRect(x: 240, y: 382, width: 1440, height: 48), using: font("Arial Unicode MS", 28, fallbackWeight: .medium), color: NSColor(calibratedRed: 0.94, green: 0.60, blue: 0.52, alpha: 1), alignment: .center)
}

context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("could not encode png\n", stderr)
    exit(5)
}
try png.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
