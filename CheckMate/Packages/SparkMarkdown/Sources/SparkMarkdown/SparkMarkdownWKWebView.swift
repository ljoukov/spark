import Foundation
import UIKit
import WebKit

final class SparkMarkdownWKWebView: WKWebView {
    private var loadContinuation: CheckedContinuation<Void, Never>?
    private var loadingTask: Task<Void, Error>?
    private var copyIconInjected = false
    private var copyIconLight: String?
    private var copyIconDark: String?

    private(set) var markdown: String = ""
    private var enableLatex: Bool = true
    private let logPrefix = "[SparkMarkdown]"

    init(enableLatex: Bool) {
        let configuration = WKWebViewConfiguration()
        super.init(frame: .zero, configuration: configuration)
        self.enableLatex = enableLatex
        navigationDelegate = self
        isOpaque = false
        backgroundColor = .clear
        scrollView.isScrollEnabled = false
        scrollView.backgroundColor = .clear
        log("init enableLatex=\(enableLatex)")

        let icons = Self.makeCopyIconDataURLs()
        copyIconLight = icons.light
        copyIconDark = icons.dark
        log("copy icons ready light=\(copyIconLight != nil) dark=\(copyIconDark != nil)")

        loadingTask = Task {
            try await loadIndexHTML()
            loadingTask = nil
        }
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func renderMarkdown(_ markdown: String, enableLatex: Bool) async throws -> CGFloat {
        self.markdown = markdown
        self.enableLatex = enableLatex
        log("renderMarkdown start len=\(markdown.count) enableLatex=\(enableLatex)")

        try await loadingTask?.value
        await ensureCopyIconsInjected()

        let escaped = try escapedMarkdown(context: markdown)
        let js = "renderMarkdown(\(escaped), \(enableLatex ? "true" : "false"))"
        let result = try await evaluateJavaScript(js)

        if let height = result as? Double {
            log("renderMarkdown height=\(height)")
            return CGFloat(height)
        }
        if let number = result as? NSNumber {
            log("renderMarkdown height(number)=\(number.doubleValue)")
            return CGFloat(number.doubleValue)
        }
        log("renderMarkdown result type=\(type(of: result)) value=\(String(describing: result))")
        await logDiagnostics(context: "renderMarkdown result")
        return 0
    }

    private func loadIndexHTML() async throws {
        await withCheckedContinuation { continuation in
            loadContinuation = continuation

            guard let indexURL = Bundle.module.url(forResource: "index", withExtension: "html") else {
                assertionFailure("Missing index.html in SparkMarkdown bundle")
                log("loadIndexHTML missing index.html")
                continuation.resume()
                return
            }
            log("loadIndexHTML url=\(indexURL)")

            loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        }
    }

    private func escapedMarkdown(context: String) throws -> String {
        return try escapedJavaScriptString(context)
    }

    private func escapedJavaScriptString(_ value: String) throws -> String {
        let jsonEncoded = try JSONSerialization.data(withJSONObject: [value])
        let jsonString = String(data: jsonEncoded, encoding: .utf8) ?? "[]"
        return String(jsonString.dropFirst().dropLast())
    }

    private func log(_ message: String) {
        print("\(logPrefix) \(message)")
    }

    @MainActor
    private func logDiagnostics(context: String) async {
        do {
            let ready = try await evaluateJavaScript("document.readyState")
            let bodyHeight = try await evaluateJavaScript("document.body.scrollHeight")
            let containerHeight = try await evaluateJavaScript("document.getElementById('markdown-content')?.scrollHeight")
            let innerLength = try await evaluateJavaScript("document.getElementById('markdown-content')?.innerHTML.length")
            log("\(context) ready=\(String(describing: ready)) bodyHeight=\(String(describing: bodyHeight)) containerHeight=\(String(describing: containerHeight)) innerLength=\(String(describing: innerLength))")
        } catch {
            log("\(context) diagnostics error=\(error)")
        }
    }

    @MainActor
    private func ensureCopyIconsInjected() async {
        guard !copyIconInjected else { return }
        guard let light = copyIconLight, let dark = copyIconDark else { return }
        do {
            let lightEscaped = try escapedJavaScriptString(light)
            let darkEscaped = try escapedJavaScriptString(dark)
            let js = "window.__sparkCopyIconLight = \(lightEscaped); window.__sparkCopyIconDark = \(darkEscaped);"
            _ = try await evaluateJavaScript(js)
            copyIconInjected = true
            log("copy icons injected")
        } catch {
            log("copy icon injection failed error=\(error)")
        }
    }

    private static func makeCopyIconDataURLs() -> (light: String?, dark: String?) {
        let light = makeSymbolDataURL(
            name: "doc.on.doc",
            pointSize: 16,
            weight: .semibold,
            color: .black
        )
        let dark = makeSymbolDataURL(
            name: "doc.on.doc",
            pointSize: 16,
            weight: .semibold,
            color: .white
        )
        return (light, dark)
    }

    private static func makeSymbolDataURL(
        name: String,
        pointSize: CGFloat,
        weight: UIImage.SymbolWeight,
        color: UIColor
    ) -> String? {
        let config = UIImage.SymbolConfiguration(pointSize: pointSize, weight: weight)
        guard let image = UIImage(systemName: name, withConfiguration: config) else {
            return nil
        }
        let renderer = UIGraphicsImageRenderer(size: image.size)
        let rendered = renderer.image { _ in
            color.set()
            image.withRenderingMode(.alwaysTemplate).draw(in: CGRect(origin: .zero, size: image.size))
        }
        guard let data = rendered.pngData() else {
            return nil
        }
        return "data:image/png;base64,\(data.base64EncodedString())"
    }

    #if compiler(>=6.1)
    @discardableResult
    override func evaluateJavaScript(_ javaScriptString: String) async throws -> Any? {
        try await loadingTask?.value
        return try await super.evaluateJavaScript(javaScriptString)
    }
    #else
    @discardableResult
    override func evaluateJavaScript(_ javaScriptString: String) async throws -> Any {
        try await loadingTask?.value
        return try await super.evaluateJavaScript(javaScriptString)
    }
    #endif
}

extension SparkMarkdownWKWebView: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let continuation = loadContinuation {
            loadContinuation = nil
            continuation.resume()
        }
        log("didFinish navigation")
    }
}
